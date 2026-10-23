import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { In, LessThan, Repository } from 'typeorm';
import { NotificationEntity } from './entities/notification.entity';
import { PushTokenEntity } from './entities/push-token.entity';
import { NotificationSettingEntity } from './entities/notification-setting.entity';
import { UserEntity } from '../user/entities/user.entity';
import {
  NIGHT_END_HOUR,
  NIGHT_START_HOUR,
  NIGHT_SUMMARY_CHANNEL_ID,
  NOTIFICATION_RETENTION_DAYS,
  NOTIFICATION_SETTING_DEFAULTS,
  NOTIFICATION_SETTING_KEY_BY_STATUS,
  NOTIFICATION_TYPE_BY_STATUS,
  NotificationSettingKey,
  NotificationStatus,
  NotificationType,
} from './enums/notification.enum';
import { ExpoPushMessage, ExpoPushService } from './expo-push.service';
import {
  buildNightSummaryPushContent,
  buildPushContent,
} from './notification-message.util';
import { R2Service } from '../storage/r2.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 1000;

// 아침에 미뤄둔 푸시를 보낼 때 한 번에 처리할 사람 수와 최대 묶음 수. 남은 사람은 다음 실행(1분 뒤)에 보낸다.
const PENDING_PUSH_USER_BATCH_SIZE = 100;
const PENDING_PUSH_MAX_BATCHES_PER_RUN = 20;
// 사람마다 DB 조회 몇 번 + Expo 요청이라, DB 풀(기본 5)을 넘지 않게 동시에 보낸다
const PENDING_PUSH_CONCURRENCY = 5;

const KST_OFFSET_HOURS = 9;

// KST 기준 야간(NIGHT_START_HOUR ~ NIGHT_END_HOUR)인지
const isKstNightTime = (date: Date) => {
  const kstHour = (date.getUTCHours() + KST_OFFSET_HOURS) % 24;

  return kstHour >= NIGHT_START_HOUR || kstHour < NIGHT_END_HOUR;
};

// now: 바로 보낸다, later: 아침에 모아서 보낸다, none: 목록에만 남긴다
type PushTiming = 'now' | 'later' | 'none';

// Expo 푸시 토큰 형식: ExponentPushToken[xxxx] 또는 ExpoPushToken[xxxx]
const EXPO_PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[.+\]$/;

export type CreateNotificationInput = {
  userId: number;
  status: NotificationStatus;
  actorId?: number | null;
  letterId?: number | null;
  feedId?: number | null;
  commentId?: number | null;
  content?: string | null;
  eventTitle?: string | null;
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private isSendingPendingPushes = false;

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,

    @InjectRepository(PushTokenEntity)
    private readonly pushTokenRepository: Repository<PushTokenEntity>,

    @InjectRepository(NotificationSettingEntity)
    private readonly settingRepository: Repository<NotificationSettingEntity>,

    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,

    private readonly expoPushService: ExpoPushService,
    private readonly r2Service: R2Service,
  ) {}

  /*
   * 알림 목록에 저장하고 푸시를 보낸다.
   * 받는 사람이 해당 알림을 꺼두었으면 목록에도 남기지 않는다.
   * 야간 알림을 꺼두었으면 밤에는 목록에만 남기고 푸시는 아침에 모아서 보낸다.
   *
   * 편지/댓글 저장이 끝난 뒤 부르는 부가 작업이라, 실패해도 에러를 던지지 않고 로그만 남긴다.
   */
  async notify(input: CreateNotificationInput) {
    try {
      const settingKey = NOTIFICATION_SETTING_KEY_BY_STATUS[input.status];
      const enabled = await this.isSettingEnabled(input.userId, settingKey);

      if (!enabled) {
        return;
      }

      const pushTiming = await this.getPushTiming(input.userId, settingKey);

      const notification = await this.notificationRepository.save(
        this.notificationRepository.create({
          userId: input.userId,
          type: NOTIFICATION_TYPE_BY_STATUS[input.status],
          status: input.status,
          actorId: input.actorId ?? null,
          letterId: input.letterId ?? null,
          feedId: input.feedId ?? null,
          commentId: input.commentId ?? null,
          content: input.content ?? null,
          eventTitle: input.eventTitle ?? null,
          pushPending: pushTiming === 'later',
        }),
      );

      if (pushTiming === 'now') {
        await this.sendPush(notification, settingKey);
      }
    } catch (error) {
      this.logger.error(
        `알림 처리 실패 (userId=${input.userId}, status=${input.status})`,
        error as Error,
      );
    }
  }

  async registerPushToken(params: {
    userId: number;
    token: string;
    platform: string;
  }) {
    const { userId, token, platform } = params;

    if (!EXPO_PUSH_TOKEN_PATTERN.test(token)) {
      throw new BadRequestException('푸시 토큰 형식이 올바르지 않습니다.');
    }

    // 같은 기기에서 다른 계정으로 바꾸면 토큰 주인만 바뀐다
    await this.pushTokenRepository.upsert(
      { userId, token, platform },
      { conflictPaths: ['token'] },
    );

    return { message: '푸시 토큰이 등록되었습니다.' };
  }

  // 내 계정에 등록된 토큰만 지운다
  async deletePushToken(userId: number, token: string) {
    await this.pushTokenRepository.delete({ userId, token });

    return { message: '푸시 토큰이 삭제되었습니다.' };
  }

  async getNotifications(params: {
    userId: number;
    type?: NotificationType;
    cursor?: number;
    limit?: number;
  }) {
    const { userId, type, cursor } = params;
    const safeLimit = Math.min(Math.max(params.limit ?? 20, 1), 50);

    const qb = this.notificationRepository
      .createQueryBuilder('notification')
      .leftJoinAndSelect('notification.actor', 'actor')
      .where('notification.userId = :userId', { userId })
      // 정리 크론이 하루 밀려도 30일이 지난 알림은 보이지 않게 한 번 더 거른다
      .andWhere('notification.createdAt >= :since', {
        since: new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * DAY_MS),
      })
      .orderBy('notification.id', 'DESC')
      .limit(safeLimit + 1);

    if (type) {
      qb.andWhere('notification.type = :type', { type });
    }

    if (cursor !== undefined) {
      qb.andWhere('notification.id < :cursor', { cursor });
    }

    const rows = await qb.getMany();
    const hasNext = rows.length > safeLimit;
    const items = (hasNext ? rows.slice(0, safeLimit) : rows).map(
      (notification) => this.formatNotificationItem(notification),
    );
    const lastItem = items[items.length - 1];

    return {
      items,
      nextCursor: hasNext && lastItem ? lastItem.notificationId : null,
      hasNext,
    };
  }

  async getSettings(userId: number) {
    const rows = await this.settingRepository.find({ where: { userId } });
    const rowByKey = new Map(rows.map((row) => [row.settingKey, row]));

    return Object.values(NotificationSettingKey).map((key) => {
      const row = rowByKey.get(key);

      return {
        key,
        enabled: row ? row.enabled : NOTIFICATION_SETTING_DEFAULTS[key],
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  async updateSettings(
    userId: number,
    settings: { key: NotificationSettingKey; enabled: boolean }[],
  ) {
    // 같은 key 가 여러 번 오면 마지막 값을 쓴다
    const enabledByKey = new Map(
      settings.map(({ key, enabled }) => [key, enabled]),
    );

    await this.settingRepository.upsert(
      [...enabledByKey].map(([settingKey, enabled]) => ({
        userId,
        settingKey,
        enabled,
      })),
      { conflictPaths: ['userId', 'settingKey'] },
    );

    return this.getSettings(userId);
  }

  /*
   * 야간에 미뤄둔 푸시를 아침에 보낸다. 사람마다 1개면 그 알림을, 2개 이상이면 묶음 푸시('새로운 알림 n개') 하나를 보낸다.
   * 묶음 푸시는 목록에 따로 남기지 않는다. 밤사이 온 알림은 목록에 하나씩 이미 남아 있다.
   * 8시 정각에 한 번만 돌면 재배포로 놓칠 수 있어서 낮 동안 매분 남은 게 있는지 본다.
   */
  @Cron('0 * 8-20 * * *', { timeZone: 'Asia/Seoul' })
  async sendPendingPushes() {
    // 처리가 1분을 넘기면 다음 실행은 건너뛴다
    if (this.isSendingPendingPushes) {
      return;
    }

    this.isSendingPendingPushes = true;

    try {
      for (
        let batch = 0;
        batch < PENDING_PUSH_MAX_BATCHES_PER_RUN;
        batch += 1
      ) {
        const users = await this.notificationRepository
          .createQueryBuilder('notification')
          .select('DISTINCT notification.userId', 'userId')
          .where('notification.pushPending = :pushPending', {
            pushPending: true,
          })
          .limit(PENDING_PUSH_USER_BATCH_SIZE)
          .getRawMany<{ userId: string }>();

        if (users.length === 0) {
          return;
        }

        for (let i = 0; i < users.length; i += PENDING_PUSH_CONCURRENCY) {
          await Promise.all(
            users
              .slice(i, i + PENDING_PUSH_CONCURRENCY)
              .map(({ userId }) =>
                this.sendPendingPushesToUser(Number(userId)),
              ),
          );
        }

        if (users.length < PENDING_PUSH_USER_BATCH_SIZE) {
          return;
        }
      }
    } catch (error) {
      this.logger.error('미뤄둔 푸시 발송 크론 실패', error as Error);
    } finally {
      this.isSendingPendingPushes = false;
    }
  }

  @Cron('0 30 3 * * *', { timeZone: 'Asia/Seoul' })
  async purgeExpiredNotifications() {
    const threshold = new Date(
      Date.now() - NOTIFICATION_RETENTION_DAYS * DAY_MS,
    );

    // 한 번에 지우면 락이 길어져서 나눠 지운다
    for (;;) {
      const rows = await this.notificationRepository.find({
        select: { id: true },
        where: { createdAt: LessThan(threshold) },
        take: CLEANUP_BATCH_SIZE,
      });

      if (rows.length === 0) {
        return;
      }

      await this.notificationRepository.delete({
        id: In(rows.map((row) => row.id)),
      });

      if (rows.length < CLEANUP_BATCH_SIZE) {
        return;
      }
    }
  }

  /*
   * 낮에는 바로 보낸다. 밤에는 야간 알림을 켠 사람에게만 바로 보내고, 끈 사람은 아침으로 미룬다.
   * 광고성 정보(이벤트)는 야간에 보내려면 별도 동의가 필요해서 밤에는 목록에만 남긴다. (정보통신망법 제50조)
   */
  private async getPushTiming(
    userId: number,
    settingKey: NotificationSettingKey,
  ): Promise<PushTiming> {
    if (!isKstNightTime(new Date())) {
      return 'now';
    }

    if (settingKey === NotificationSettingKey.EVENT) {
      return 'none';
    }

    const isNightEnabled = await this.isSettingEnabled(
      userId,
      NotificationSettingKey.NIGHT,
    );

    return isNightEnabled ? 'now' : 'later';
  }

  // 한 사람에게 밤사이 쌓인 푸시. 실패해도 다른 사람 발송은 이어간다.
  private async sendPendingPushesToUser(userId: number) {
    try {
      const rows = await this.notificationRepository.find({
        where: { userId, pushPending: true },
        order: { id: 'ASC' },
      });

      if (rows.length === 0) {
        return;
      }

      // 재배포 중에는 이전/새 컨테이너가 잠깐 같이 떠 있어서, 표시를 먼저 지운 쪽만 보낸다
      const result = await this.notificationRepository.update(
        { id: In(rows.map((row) => row.id)), pushPending: true },
        { pushPending: false },
      );

      if ((result.affected ?? 0) === 0) {
        return;
      }

      // 밤사이 꺼둔 종류는 빼고 보낸다. 목록에는 이미 남아 있다.
      const settings = await this.getSettings(userId);
      const enabledKeys = new Set(
        settings.filter(({ enabled }) => enabled).map(({ key }) => key),
      );
      const pushRows = rows.filter((row) =>
        enabledKeys.has(NOTIFICATION_SETTING_KEY_BY_STATUS[row.status]),
      );

      if (pushRows.length === 1) {
        const [row] = pushRows;
        await this.sendPush(
          row,
          NOTIFICATION_SETTING_KEY_BY_STATUS[row.status],
        );
        return;
      }

      // 이동할 원본이 없어서 data 를 넣지 않는다. 누르면 프론트가 알림 목록으로 보낸다.
      if (pushRows.length > 1) {
        await this.sendToTokens(await this.getPushTokens(userId), {
          ...buildNightSummaryPushContent(pushRows.length),
          channelId: NIGHT_SUMMARY_CHANNEL_ID,
        });
      }
    } catch (error) {
      this.logger.error(
        `미뤄둔 푸시 발송 실패 (userId=${userId})`,
        error as Error,
      );
    }
  }

  private async isSettingEnabled(userId: number, key: NotificationSettingKey) {
    const row = await this.settingRepository.findOne({
      where: { userId, settingKey: key },
    });

    return row ? row.enabled : NOTIFICATION_SETTING_DEFAULTS[key];
  }

  private async sendPush(
    notification: NotificationEntity,
    settingKey: NotificationSettingKey,
  ) {
    const tokens = await this.getPushTokens(notification.userId);

    if (tokens.length === 0) {
      return;
    }

    const actor = notification.actorId
      ? await this.userRepository.findOne({
          select: { id: true, publicId: true, nickname: true, userCode: true },
          where: { id: notification.actorId },
        })
      : null;

    // 팔로우 알림 본문에 내 닉네임이 들어간다
    const recipient =
      notification.status === NotificationStatus.FOLLOW
        ? await this.userRepository.findOne({
            select: { id: true, nickname: true },
            where: { id: notification.userId },
          })
        : null;

    const { title, body } = buildPushContent({
      status: notification.status,
      actorNickname: actor?.nickname,
      actorUserCode: actor?.userCode,
      recipientNickname: recipient?.nickname,
      isToSelf: this.isToSelf(notification),
      content: notification.content,
      eventTitle: notification.eventTitle,
    });

    // 알림을 눌렀을 때 이동할 화면을 프론트가 고를 수 있게 넘긴다
    const data = {
      notificationId: Number(notification.id),
      type: notification.type,
      status: notification.status,
      letterId: this.toNullableNumber(notification.letterId),
      feedId: this.toNullableNumber(notification.feedId),
      commentId: this.toNullableNumber(notification.commentId),
      // 팔로우 알림을 누르면 그 사람 프로필로 간다
      actorPublicId: actor?.publicId ?? null,
    };

    await this.sendToTokens(tokens, {
      title,
      body,
      data,
      channelId: settingKey,
    });
  }

  private async getPushTokens(userId: number) {
    const rows = await this.pushTokenRepository.find({
      select: { token: true },
      where: { userId },
    });

    return rows.map(({ token }) => token);
  }

  private async sendToTokens(
    tokens: string[],
    message: Omit<ExpoPushMessage, 'to'>,
  ) {
    if (tokens.length === 0) {
      return;
    }

    await this.expoPushService.send(
      tokens.map((token) => ({ to: token, ...message })),
    );
  }

  // NotificationListItem 이 받는 props 형태
  private formatNotificationItem(notification: NotificationEntity) {
    const { actor } = notification;
    const showsUserCode =
      notification.status === NotificationStatus.COMMENT ||
      notification.status === NotificationStatus.REPLY ||
      notification.status === NotificationStatus.FOLLOW;

    return {
      notificationId: Number(notification.id),
      type: notification.type,
      status: notification.status,
      // 댓글/답글/팔로우는 아이디(userCode), 편지는 닉네임
      name: actor ? (showsUserCode ? actor.userCode : actor.nickname) : null,
      // 팔로우 알림을 누르면 그 사람 프로필로 간다
      actorPublicId: actor?.publicId ?? null,
      profileImageUrl: actor
        ? this.r2Service.getProfileImageUrl(actor.profileImageKey)
        : null,
      content: notification.content,
      eventTitle: notification.eventTitle,
      isToSelf: this.isToSelf(notification),
      letterId: this.toNullableNumber(notification.letterId),
      feedId: this.toNullableNumber(notification.feedId),
      commentId: this.toNullableNumber(notification.commentId),
      createdAt: notification.createdAt,
    };
  }

  // 나에게 쓴 편지는 받는 사람과 보낸 사람(actor)이 같다
  private isToSelf(notification: NotificationEntity) {
    return (
      notification.status === NotificationStatus.RECEIVE &&
      notification.actorId !== null &&
      Number(notification.actorId) === Number(notification.userId)
    );
  }

  private toNullableNumber(value: number | null) {
    return value === null ? null : Number(value);
  }
}
