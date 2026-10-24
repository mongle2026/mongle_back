import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
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
import { KakaoApiService } from './kakao-api.service';
import { AppleApiService } from './apple-api.service';

/**
 * 회원 탈퇴.
 *
 * 남는 것: 내가 단 댓글, 상대에게 도착한 편지(우표 포함). 보낸 사람은 "(탈퇴한 회원)"으로 보인다.
 * 사라지는 것: 내 피드, 아직 도착하지 않은 편지, 내 편지함, 좋아요/북마크/팔로우, 내 알림/푸시 토큰/알림 설정.
 *
 * user 행은 지우지 않고 개인정보만 비운다. 남은 편지/댓글에서 보낸 사람을 사람마다 구분해야 하기 때문이다.
 * 피드와 편지는 직접 삭제할 때와 같은 표시만 하고, 실제 삭제는 기존 정리 크론이 보관 기간 뒤에 한다.
 */
@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly profileImageService: ProfileImageService,
    private readonly kakaoApiService: KakaoApiService,
    private readonly appleApiService: AppleApiService,
  ) {}

  // authorizationCode: 애플 회원만. 탈퇴 직전에 애플 로그인을 한 번 더 해서 받은 값
  async withdraw(userId: number, authorizationCode?: string) {
    const account = await this.dataSource.transaction(async (manager) => {
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

      // 애플은 연결을 끊으려면 앱에서 받은 코드가 꼭 있어야 해서, 빠뜨리면 탈퇴 전에 막는다
      if (user.provider === AuthProvider.APPLE && !authorizationCode) {
        throw new BadRequestException(
          '애플 계정은 탈퇴할 때 애플 로그인 인증(authorizationCode)이 필요합니다.',
        );
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

      await manager.update(
        UserEntity,
        { id: userId },
        {
          withdrawnAt: now,
          providerUserId: null,
          userCode: null,
          nickname: '',
          profileImageKey: null,
          refreshTokenHash: null,
        },
      );

      return { provider: user.provider, providerUserId: user.providerUserId };
    });

    // 탈퇴가 커밋된 뒤에 끊는다. 실패해도 탈퇴는 그대로 두고 로그만 남긴다.
    await this.unlinkSocialAccount(
      account.provider,
      account.providerUserId,
      authorizationCode,
    );

    return { message: '탈퇴되었습니다.' };
  }

  private async unlinkSocialAccount(
    provider: AuthProvider,
    providerUserId: string | null,
    authorizationCode?: string,
  ) {
    if (!providerUserId) {
      return;
    }

    try {
      switch (provider) {
        case AuthProvider.KAKAO:
          await this.kakaoApiService.unlink(providerUserId);
          break;
        case AuthProvider.APPLE:
          // 코드가 없으면 탈퇴 트랜잭션에서 이미 막았다
          if (authorizationCode) {
            await this.appleApiService.revoke(
              authorizationCode,
              providerUserId,
            );
          }
          break;
      }
    } catch (error) {
      // 카카오/애플이 돌려준 에러 본문(예: 애플 코드 만료 invalid_grant)도 함께 남긴다
      const response = axios.isAxiosError(error)
        ? ` response=${JSON.stringify(error.response?.data)}`
        : '';

      this.logger.error(
        `소셜 연결 끊기 실패 (provider=${provider}, providerUserId=${providerUserId})${response}`,
        error as Error,
      );
    }
  }
}
