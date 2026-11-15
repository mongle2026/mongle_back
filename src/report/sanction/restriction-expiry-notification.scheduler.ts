import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { NotificationService } from '../../notification/notification.service';
import { NotificationStatus } from '../../notification/enums/notification.enum';

const BATCH_SIZE = 100;
// 한 번 실행에서 처리할 최대 묶음 수. 남은 회원은 다음 실행(1분 뒤)에 이어서 처리한다
const MAX_BATCHES_PER_RUN = 20;
// 알림 한 건이 DB 조회 몇 번 + Expo 요청이라, DB 풀(기본 5)을 넘지 않게 동시에 보낸다
const NOTIFY_CONCURRENCY = 5;

// 끝난 지 이보다 오래된 정지는 해제 안내를 보내지 않는다.
// 끝난 정지 기록은 1년 동안 남아서(moderation-retention) 최근에 끝난 것만 IDX_user_restricted_until 로 찾고,
// 서버가 오래 멈췄다 다시 뜰 때 한참 지난 해제 안내가 늦게 나가는 것도 막는다
const EXPIRY_NOTIFICATION_WINDOW_MS = 24 * 60 * 60 * 1000;

// 해제 안내를 보낼 회원: 탈퇴하지 않았고, 기간 정지가 최근(:since ~ :now)에 끝났고, 끝난 뒤 해제 안내를 아직 보내지 않았다.
// 영구 정지(restricted_until null)는 끝나지 않으므로 빠진다. 조회와 표시(claim)에 같이 쓴다
const EXPIRY_NOTIFICATION_DUE = `restricted_until > :since
  AND restricted_until <= :now
  AND restricted_at IS NOT NULL
  AND withdrawn_at IS NULL
  AND (restriction_expiry_notified_at IS NULL OR restriction_expiry_notified_at < restricted_until)`;

const getDueParams = (now: Date) => ({
  since: new Date(now.getTime() - EXPIRY_NOTIFICATION_WINDOW_MS),
  now,
});

/*
 * 이용 정지 기간이 끝나면 회원에게 '이용 정지 해제 안내' 알림(목록 + 푸시)을 보낸다.
 * 기간 정지는 restricted_until 이 지나면 따로 풀지 않아도 풀린 것으로 보므로(isRestrictedUser),
 * 매분 돌면서 "최근 하루 안에 기간이 끝났는데 아직 해제 안내를 보내지 않은 회원"을 찾는다.
 * 이의 신청 받아들임 · 신고 처리 되돌림으로 기간 전에 풀린 건 restricted_at 을 비우므로 여기서 보내지 않는다.
 *
 * 재배포 중에는 이전/새 컨테이너가 잠깐 같이 떠 있어서, 회원마다 조건부 UPDATE 로
 * 보낸 표시(restriction_expiry_notified_at)를 먼저 남긴 쪽만 알림을 보낸다.
 */
@Injectable()
export class RestrictionExpiryNotificationScheduler {
  private readonly logger = new Logger(
    RestrictionExpiryNotificationScheduler.name,
  );
  private isRunning = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron('0 * * * * *')
  async handleRestrictionExpiry() {
    // 처리가 1분을 넘기면 다음 실행은 건너뛴다
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      await this.notifyExpiredRestrictions(new Date());
    } catch (error) {
      this.logger.error('이용 정지 해제 안내 크론 실패', error as Error);
    } finally {
      this.isRunning = false;
    }
  }

  private async notifyExpiredRestrictions(now: Date) {
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const users = await this.dataSource
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .select('user.id')
        .where(EXPIRY_NOTIFICATION_DUE, getDueParams(now))
        .orderBy('user.id', 'ASC')
        .take(BATCH_SIZE)
        .getMany();

      if (users.length === 0) {
        return;
      }

      const userIds: number[] = [];

      for (const user of users) {
        if (await this.claim(Number(user.id), now)) {
          userIds.push(Number(user.id));
        }
      }

      for (let i = 0; i < userIds.length; i += NOTIFY_CONCURRENCY) {
        await Promise.all(
          userIds.slice(i, i + NOTIFY_CONCURRENCY).map((userId) =>
            this.notificationService.notify({
              userId,
              status: NotificationStatus.RESTRICTION_EXPIRED,
            }),
          ),
        );
      }

      if (users.length < BATCH_SIZE) {
        return;
      }
    }
  }

  // 아직 조건이 그대로일 때만 표시한다. 영향받은 행이 있으면 이 프로세스가 보낼 차례다
  private async claim(userId: number, now: Date) {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(UserEntity)
      .set({ restrictionExpiryNotifiedAt: now })
      .where(EXPIRY_NOTIFICATION_DUE, getDueParams(now))
      .andWhere('id = :userId', { userId })
      .execute();

    return (result.affected ?? 0) > 0;
  }
}
