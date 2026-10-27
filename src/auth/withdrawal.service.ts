import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In, IsNull, MoreThan } from 'typeorm';
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
import { AppleApiService } from './apple-api.service';
import { SocialUnlinkService } from './social-unlink.service';

/**
 * 회원 탈퇴.
 *
 * 남는 것: 내가 단 댓글, 상대에게 도착한 편지(우표 포함). 보낸 사람은 "(탈퇴한 회원)"으로 보인다.
 * 사라지는 것: 내 피드, 아직 도착하지 않은 편지, 내 편지함, 좋아요/북마크/팔로우, 내 알림/푸시 토큰/알림 설정.
 *
 * user 행은 지우지 않고 개인정보만 비운다. 남은 편지/댓글에서 보낸 사람을 사람마다 구분해야 하기 때문이다.
 * 피드와 편지는 직접 삭제할 때와 같은 표시만 하고, 실제 삭제는 기존 정리 크론이 보관 기간 뒤에 한다.
 * 소셜 계정 연결 끊기는 탈퇴가 커밋된 뒤에 하고, 실패하면 SocialUnlinkService 가 다시 시도한다.
 */
@Injectable()
export class WithdrawalService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly profileImageService: ProfileImageService,
    private readonly appleApiService: AppleApiService,
    private readonly socialUnlinkService: SocialUnlinkService,
  ) {}

  // authorizationCode: 애플 회원만. 탈퇴 직전에 애플 로그인을 한 번 더 해서 받은 값
  async withdraw(userId: number, authorizationCode?: string) {
    const appleRefreshToken = await this.prepareAppleUnlink(
      userId,
      authorizationCode,
    );

    const pendingId = await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(UserEntity, {
        select: {
          id: true,
          provider: true,
          providerUserId: true,
          profileImageKey: true,
          withdrawnAt: true,
        },
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!user || user.withdrawnAt) {
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      }

      const now = new Date();

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

      // 내가 받은 알림만 지운다. 내가 상대(actor)인 다른 사람의 알림은 "(탈퇴한 회원)"으로 남는다.
      await manager.delete(NotificationEntity, { userId });
      await manager.delete(PushTokenEntity, { userId });
      await manager.delete(NotificationSettingEntity, { userId });

      if (user.profileImageKey) {
        await this.profileImageService.discard(manager, user.profileImageKey);
      }

      // 아래에서 user 의 providerUserId 를 비우기 전에 연결 끊기 작업으로 옮겨 둔다
      const unlinkPendingId = user.providerUserId
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
          email: null,
          userCode: null,
          nickname: '',
          profileImageKey: null,
          refreshTokenHash: null,
        },
      );

      return unlinkPendingId;
    });

    // 탈퇴가 커밋된 뒤에 끊는다. 실패해도 탈퇴는 그대로 두고 나중에 다시 시도한다.
    if (pendingId) {
      await this.socialUnlinkService.unlinkNow(pendingId);
    }

    return { message: '탈퇴되었습니다.' };
  }

  /**
   * 애플 회원이면 앱에서 받은 코드를 연결 끊기에 쓸 refresh token 으로 바꿔 둔다.
   * 코드는 5분 안에 한 번만 쓸 수 있어 나중에 다시 시도할 수 없으므로, 탈퇴 전에 하고 실패하면 탈퇴하지 않는다.
   * 카카오 회원은 null.
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

    if (!authorizationCode) {
      throw new BadRequestException(
        '애플 계정은 탈퇴할 때 애플 로그인 인증(authorizationCode)이 필요합니다.',
      );
    }

    return this.appleApiService.exchangeCodeForRefreshToken(
      authorizationCode,
      user.providerUserId,
    );
  }
}
