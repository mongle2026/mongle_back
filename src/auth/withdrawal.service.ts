import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, MoreThan } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { AuthProvider } from '../user/enums/auth-provider.enum';
import { ProfileImageService } from '../user/profile-image.service';
import { FeedEntity } from '../feed/entities/feed.entity';
import { FeedLikeEntity } from '../like/entities/feed-like.entity';
import { BookmarkEntity } from '../bookmark/entities/bookmark.entity';
import { FollowEntity } from '../follow/entities/follow.entity';
import { LetterEntity } from '../letter/entities/letter.entity';
import { NotificationEntity } from '../notification/entities/notification.entity';
import { PushTokenEntity } from '../notification/entities/push-token.entity';
import { NotificationSettingEntity } from '../notification/entities/notification-setting.entity';
import { UserBlockEntity } from '../block/entities/user-block.entity';
import { UserEventEntity } from '../user-event/entities/user-event.entity';
import { FeedImpressionEntity } from '../recommendation/entities/feed-impression.entity';
import { MusicPlayEntity } from '../recommendation/entities/music-play.entity';
import { AppleApiService } from './apple-api.service';
import { SocialUnlinkService } from './social-unlink.service';
import { BannedAccountEntity } from './entities/banned-account.entity';
import {
  isPermanentlyRestrictedUser,
  isRestrictedUser,
} from '../user/withdrawn-user';
import {
  addMonths,
  getAppealDeadline,
} from '../report/sanction/sanction.constants';
import {
  AppealStatus,
  RestrictionAppealEntity,
} from '../report/appeal/entities/restriction-appeal.entity';
import { PERMANENT_REJOIN_BAN_MONTHS } from '../report/retention/retention.constants';

type WithdrawingUser = Pick<
  UserEntity,
  | 'id'
  | 'provider'
  | 'providerUserId'
  | 'appleRefreshToken'
  | 'profileImageKey'
  | 'withdrawnAt'
  | 'restrictedAt'
  | 'restrictedUntil'
  | 'restrictedReason'
>;

/**
 * 회원 탈퇴.
 *
 * 남는 것: 내가 단 댓글, 상대에게 도착한 편지(우표 포함). 보낸 사람은 "(탈퇴한 회원)"으로 보인다.
 * 사라지는 것: 내 피드, 아직 도착하지 않은 편지, 내 편지함, 좋아요/북마크/팔로우/내 차단 목록, 내 알림/푸시 토큰/알림 설정,
 * 이용 기록(user_event · feed_impression · music_play).
 *
 * user 행은 지우지 않고 개인정보만 비운다. 남은 편지/댓글에서 보낸 사람을 사람마다 구분해야 하기 때문이다.
 * 피드와 편지는 직접 삭제할 때와 같은 표시만 하고, 실제 삭제는 기존 정리 크론이 보관 기간 뒤에 한다.
 * 소셜 계정 연결 끊기는 탈퇴가 커밋된 뒤에 하고, 실패하면 SocialUnlinkService 가 다시 시도한다.
 *
 * 운영자가 영구 정지된 회원을 탈퇴시킬 때(forceWithdraw)와, 이의 신청 기간이 끝난 영구 정지 회원을
 * 크론이 탈퇴시킬 때(withdrawAfterAppealPeriod)도 같은 처리를 한다.
 *
 * 이용 제한 중에 탈퇴하면(본인 · 운영자 모두) 같은 소셜 계정으로 바로 다시 가입하지 못하게 banned_account 에 남긴다.
 * 영구 정지는 탈퇴 후 1년, 기간 정지는 정지가 끝날 때까지 막는다 (개인정보처리방침의 재가입 제한 정보 보관 기간).
 *
 * 애플 연결 끊기에는 애플 refresh token 이 필요하다. 로그인 · 가입 때 받아 둔 값(user.apple_refresh_token)을 쓰고,
 * 본인 탈퇴에서 앱이 authorizationCode 를 보내면 그 코드로 새로 받은 값을 쓴다.
 */
@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly profileImageService: ProfileImageService,
    private readonly appleApiService: AppleApiService,
    private readonly socialUnlinkService: SocialUnlinkService,
  ) {}

  // authorizationCode: 애플 회원만. 탈퇴 직전에 애플 로그인을 한 번 더 해서 받은 값.
  // 로그인 때 받아 둔 애플 refresh token 이 있으면 보내지 않아도 된다
  async withdraw(userId: number, authorizationCode?: string) {
    const appleRefreshToken = await this.prepareAppleUnlink(
      userId,
      authorizationCode,
    );

    const pendingId = await this.dataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, userId);

      if (!user || user.withdrawnAt) {
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      }

      return await this.withdrawInTransaction(
        manager,
        user,
        appleRefreshToken,
        null,
      );
    });

    this.unlinkAfterCommit(pendingId);

    return { message: '탈퇴되었습니다.' };
  }

  /**
   * 운영자가 영구 정지된 회원을 탈퇴시킨다 (신고 처리). 되돌릴 수 없다.
   * 같은 소셜 계정으로 1년 동안 다시 가입하지 못하게 banned_account 에 소셜 계정을 남긴다.
   * 카카오는 Admin 키로, 애플은 로그인 때 받아 둔 refresh token 으로 연결을 끊는다.
   * 애플 refresh token 이 없으면(받기 전에 가입하고 다시 로그인하지 않은 회원) 애플 연결은 끊지 못한다.
   */
  async forceWithdraw(userId: number, bannedBy: string | null) {
    const pendingId = await this.dataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, userId);

      if (!user || user.withdrawnAt) {
        throw new BadRequestException('이미 탈퇴했거나 없는 회원이에요.');
      }

      if (!isPermanentlyRestrictedUser(user)) {
        throw new BadRequestException('영구 정지된 회원만 탈퇴시킬 수 있어요.');
      }

      return await this.withdrawRestrictedUser(manager, user, bannedBy);
    });

    this.unlinkAfterCommit(pendingId);

    return { message: '탈퇴시켰습니다.' };
  }

  /**
   * 이의 신청 기간(제한 후 PERMANENT_APPEAL_DAYS 일)이 끝난 영구 정지 회원을 탈퇴시킨다 (매일 크론).
   * 처리는 운영자가 탈퇴시킬 때(forceWithdraw)와 같고, 탈퇴시킨 운영자는 null 로 남는다.
   * 회원 행을 잠근 뒤 다시 확인해서, 그 사이 제한이 풀렸거나 기간이 남았거나
   * 이 제한에 검토 중인 이의 신청이 있으면 탈퇴시키지 않는다. 탈퇴시켰으면 true
   */
  async withdrawAfterAppealPeriod(userId: number, now = new Date()) {
    const result = await this.dataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, userId);

      if (
        !user ||
        user.withdrawnAt ||
        !isPermanentlyRestrictedUser(user) ||
        getAppealDeadline(user.restrictedAt!, null) > now
      ) {
        return null;
      }

      const hasPendingAppeal = await manager.exists(RestrictionAppealEntity, {
        where: {
          userId,
          restrictedAt: user.restrictedAt!,
          status: AppealStatus.PENDING,
        },
      });

      if (hasPendingAppeal) {
        return null;
      }

      return {
        pendingId: await this.withdrawRestrictedUser(manager, user, null),
      };
    });

    if (!result) {
      return false;
    }

    this.unlinkAfterCommit(result.pendingId);

    return true;
  }

  // 영구 정지된 회원을 운영 조치로 탈퇴시킨다. 애플은 로그인 때 받아 둔 refresh token 으로 끊는다
  private async withdrawRestrictedUser(
    manager: EntityManager,
    user: WithdrawingUser,
    bannedBy: string | null,
  ) {
    if (user.provider === AuthProvider.APPLE && !user.appleRefreshToken) {
      this.logger.warn(
        `애플 refresh token 이 없어 애플 연결을 끊지 못함 (userId=${user.id})`,
      );
    }

    return await this.withdrawInTransaction(
      manager,
      user,
      user.appleRefreshToken,
      bannedBy,
    );
  }

  private async lockUser(manager: EntityManager, userId: number) {
    return await manager.findOne(UserEntity, {
      select: {
        id: true,
        provider: true,
        providerUserId: true,
        appleRefreshToken: true,
        profileImageKey: true,
        withdrawnAt: true,
        restrictedAt: true,
        restrictedUntil: true,
        restrictedReason: true,
      },
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  // 탈퇴가 커밋된 뒤에 끊는다. 실패해도 탈퇴는 그대로 두고 나중에 다시 시도한다.
  // 카카오 · 애플 응답을 기다리지 않고 바로 응답한다 (unlinkNow 는 예외를 던지지 않는다)
  private unlinkAfterCommit(pendingId: number | null) {
    if (pendingId) {
      void this.socialUnlinkService.unlinkNow(pendingId);
    }
  }

  // 회원 행을 잠근 트랜잭션 안에서 부른다. 연결 끊기 작업 id 를 돌려준다 (끊지 않으면 null)
  // 애플은 appleRefreshToken 이 있어야 끊는다. bannedBy: 탈퇴시킨 운영자 (본인 탈퇴 · 터미널 · 자동 탈퇴면 null)
  private async withdrawInTransaction(
    manager: EntityManager,
    user: WithdrawingUser,
    appleRefreshToken: string | null,
    bannedBy: string | null,
  ) {
    const userId = Number(user.id);
    const now = new Date();

    await this.banRejoinIfRestricted(manager, user, bannedBy, now);

    // 내 피드: 직접 삭제(FeedService.deleteFeed)와 같게 좋아요/북마크를 지우고 soft delete
    const feeds = await manager
      .getRepository(FeedEntity)
      .createQueryBuilder('feed')
      .innerJoin('feed.record', 'record')
      .select('feed.id', 'id')
      .where('record.userId = :userId', { userId })
      .getRawMany<{ id: string }>();

    if (feeds.length > 0) {
      const feedIds = feeds.map((feed) => Number(feed.id));

      await manager.delete(FeedLikeEntity, { feedId: In(feedIds) });
      await manager.delete(BookmarkEntity, { feedId: In(feedIds) });
      await manager.softDelete(FeedEntity, { id: In(feedIds) });
    }

    // 아직 도착하지 않은 보낸 편지: 발송 취소와 같게 받는 사람 쪽도 함께 삭제해서 도착하지 않게 한다
    await manager.update(
      LetterEntity,
      {
        senderId: userId,
        senderDeletedAt: IsNull(),
        deliveryAt: MoreThan(now),
      },
      { senderDeletedAt: now, receiverDeletedAt: now },
    );

    // 이미 도착한 보낸 편지: 내 편지함에서만 빠지고 받는 사람 편지함에는 남는다
    await manager.update(
      LetterEntity,
      { senderId: userId, senderDeletedAt: IsNull() },
      { senderDeletedAt: now },
    );

    // 받은 편지(도착 전 포함): 보낸 사람 편지함에는 남는다
    await manager.update(
      LetterEntity,
      { receiverId: userId, receiverDeletedAt: IsNull() },
      { receiverDeletedAt: now },
    );

    await manager.delete(FeedLikeEntity, { userId });
    await manager.delete(BookmarkEntity, { userId });
    await manager.delete(FollowEntity, { followerId: userId });
    await manager.delete(FollowEntity, { followingId: userId });
    // 내가 차단한 목록만 지운다. 다른 사람이 나를 차단한 기록은 그 사람의 목록이라 남긴다
    await manager.delete(UserBlockEntity, { blockerId: userId });

    // 내가 받은 알림만 지운다. 내가 상대(actor)인 다른 사람의 알림은 "(탈퇴한 회원)"으로 남는다.
    await manager.delete(NotificationEntity, { userId });
    // 내 계정에 등록된 기기 토큰(기기 OS 포함)을 지운다. 로그인하지 않은 기기(user_id 가 null)의 토큰은 건드리지 않는다.
    // 탈퇴한 뒤 그 기기에서 앱이 로그인 없이 토큰을 다시 등록하면 새 로그인하지 않은 기기가 된다
    await manager.delete(PushTokenEntity, { userId });
    await manager.delete(NotificationSettingEntity, { userId });

    // 이용 기록 (행동 기록 · 추천으로 보여준 글 · 미리듣기 재생 기록)
    await manager.delete(UserEventEntity, { userId });
    await manager.delete(FeedImpressionEntity, { userId });
    await manager.delete(MusicPlayEntity, { userId });

    if (user.profileImageKey) {
      await this.profileImageService.discard(manager, user.profileImageKey);
    }

    // 아래에서 user 의 providerUserId 를 비우기 전에 연결 끊기 작업으로 옮겨 둔다
    const canUnlink =
      user.provider === AuthProvider.KAKAO || appleRefreshToken !== null;
    const unlinkPendingId =
      canUnlink && user.providerUserId
        ? await this.socialUnlinkService.enqueue(manager, {
            provider: user.provider,
            providerUserId: user.providerUserId,
            appleRefreshToken,
          })
        : null;

    await manager.update(
      UserEntity,
      { id: userId },
      {
        withdrawnAt: now,
        providerUserId: null,
        appleRefreshToken: null,
        email: null,
        userCode: null,
        nickname: null,
        profileImageKey: null,
        defaultProfileImageNo: null,
        refreshTokenHash: null,
      },
    );

    return unlinkPendingId;
  }

  /**
   * 이용 제한 중이면 같은 소셜 계정으로 다시 가입하지 못하게 banned_account 에 남긴다.
   * 영구 정지는 탈퇴 후 1년, 기간 정지는 정지가 끝나는 시각까지. 탈퇴하면 provider_user_id 가 비워지므로 그 전에 부른다.
   * 기간이 지났지만 크론이 아직 지우지 않은 예전 행이 있을 수 있어서 덮어쓴다
   */
  private async banRejoinIfRestricted(
    manager: EntityManager,
    user: WithdrawingUser,
    bannedBy: string | null,
    now: Date,
  ) {
    if (!user.providerUserId || !isRestrictedUser(user, now)) {
      return;
    }

    const expiresAt = user.restrictedUntil
      ? new Date(user.restrictedUntil)
      : addMonths(now, PERMANENT_REJOIN_BAN_MONTHS);

    await manager
      .createQueryBuilder()
      .insert()
      .into(BannedAccountEntity)
      .values({
        provider: user.provider,
        providerUserId: user.providerUserId,
        userId: Number(user.id),
        reason: user.restrictedReason,
        bannedBy,
        expiresAt,
      })
      // PG 의 ON CONFLICT DO UPDATE 는 어느 unique 에 걸린 경우인지(provider + provider_user_id) 꼭 적어야 한다
      .orUpdate(
        ['user_id', 'reason', 'banned_by', 'expires_at'],
        ['provider', 'provider_user_id'],
      )
      .execute();
  }

  /**
   * 애플 회원이면 연결 끊기에 쓸 refresh token 을 정한다. 카카오 회원은 null.
   * 앱이 코드를 보냈으면 그 코드로 새로 받는다. 코드는 5분 안에 한 번만 쓸 수 있어 나중에 다시 시도할 수 없으므로 탈퇴 전에 한다.
   * 코드가 없거나 바꾸지 못하면 로그인 때 받아 둔 값을 쓰고, 그것도 없으면 탈퇴하지 않는다.
   */
  private async prepareAppleUnlink(
    userId: number,
    authorizationCode?: string,
  ): Promise<string | null> {
    const user = await this.dataSource.manager.findOne(UserEntity, {
      select: {
        id: true,
        provider: true,
        providerUserId: true,
        appleRefreshToken: true,
        withdrawnAt: true,
      },
      where: { id: userId },
    });

    if (!user || user.withdrawnAt) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    if (user.provider !== AuthProvider.APPLE || !user.providerUserId) {
      return null;
    }

    if (authorizationCode) {
      try {
        return await this.appleApiService.exchangeCodeForRefreshToken(
          authorizationCode,
          user.providerUserId,
        );
      } catch (error) {
        if (!user.appleRefreshToken) {
          throw error;
        }

        this.logger.warn(
          `탈퇴 때 받은 애플 코드 교환 실패. 로그인 때 받아 둔 값으로 끊음 (userId=${user.id}, ${String(error)})`,
        );
      }
    }

    if (!user.appleRefreshToken) {
      throw new BadRequestException(
        '애플 계정은 탈퇴할 때 애플 로그인 인증(authorizationCode)이 필요합니다.',
      );
    }

    return user.appleRefreshToken;
  }
}
