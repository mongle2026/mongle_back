import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { In, LessThan, Repository } from 'typeorm';
import { NotificationEntity } from './entities/notification.entity';
import { PushTokenEntity } from './entities/push-token.entity';
import { NotificationSettingEntity } from './entities/notification-setting.entity';
import { UserEntity } from '../user/entities/user.entity';
import {
  NOTIFICATION_RETENTION_DAYS,
  NOTIFICATION_SETTING_DEFAULTS,
  NOTIFICATION_SETTING_KEY_BY_STATUS,
  NOTIFICATION_TYPE_BY_STATUS,
  NotificationSettingKey,
  NotificationStatus,
  NotificationType,
} from './enums/notification.enum';
import { ExpoPushService } from './expo-push.service';
import { buildPushContent } from './notification-message.util';
import { R2Service } from '../storage/r2.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 1000;

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
        }),
      );

      await this.sendPush(notification, settingKey);
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

  async deletePushToken(token: string) {
    await this.pushTokenRepository.delete({ token });

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

  async updateSetting(params: {
    userId: number;
    key: NotificationSettingKey;
    enabled: boolean;
  }) {
    const { userId, key, enabled } = params;

    await this.settingRepository.upsert(
      { userId, settingKey: key, enabled },
      { conflictPaths: ['userId', 'settingKey'] },
    );

    const row = await this.settingRepository.findOneOrFail({
      where: { userId, settingKey: key },
    });

    return {
      key,
      enabled: row.enabled,
      updatedAt: row.updatedAt,
    };
  }

  @Cron('0 30 3 * * *')
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
    const tokens = await this.pushTokenRepository.find({
      select: { token: true },
      where: { userId: notification.userId },
    });

    if (tokens.length === 0) {
      return;
    }

    const actor = notification.actorId
      ? await this.userRepository.findOne({
          select: { id: true, nickname: true, userCode: true },
          where: { id: notification.actorId },
        })
      : null;

    const { title, body } = buildPushContent({
      status: notification.status,
      actorNickname: actor?.nickname,
      actorUserCode: actor?.userCode,
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
    };

    await this.expoPushService.send(
      tokens.map(({ token }) => ({
        to: token,
        title,
        body,
        data,
        channelId: settingKey,
      })),
    );
  }

  // NotificationListItem 이 받는 props 형태
  private formatNotificationItem(notification: NotificationEntity) {
    const { actor } = notification;
    const isFeed = notification.type === NotificationType.FEED;

    return {
      notificationId: Number(notification.id),
      type: notification.type,
      status: notification.status,
      // 편지는 닉네임, 피드는 아이디(userCode)
      name: actor ? (isFeed ? actor.userCode : actor.nickname) : null,
      profileImageUrl: actor
        ? this.r2Service.getProfileImageUrl(
            actor.id,
            actor.imageMimeType,
            actor.imageUpdatedAt,
          )
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
