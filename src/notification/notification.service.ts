import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { In, IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';
import { NotificationEntity } from './entities/notification.entity';
import { PushTokenEntity } from './entities/push-token.entity';
import { NotificationSettingEntity } from './entities/notification-setting.entity';
import { UserEntity } from '../user/entities/user.entity';
import { FeedCommentEntity } from '../feed-comment/entities/feed-comment.entity';
import {
  ALWAYS_DELIVERED_STATUSES,
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
import { getDisplayNickname, isWithdrawnUser } from '../user/withdrawn-user';
import { BlockService } from '../block/block.service';
import { ReportTargetType } from '../report/enums/report.enum';
import { SanctionNotice } from '../report/sanction/sanction.constants';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 1000;

// 아침에 미뤄둔 푸시를 보낼 때 한 번에 처리할 사람 수와 최대 묶음 수. 남은 사람은 다음 실행(1분 뒤)에 보낸다.
const PENDING_PUSH_USER_BATCH_SIZE = 100;
const PENDING_PUSH_MAX_BATCHES_PER_RUN = 20;
// 사람마다 DB 조회 몇 번 + Expo 요청이라, DB 풀(기본 5)을 넘지 않게 동시에 보낸다
const PENDING_PUSH_CONCURRENCY = 5;

// 공지를 보낼 때 한 번에 처리할 회원 수 · 기기 수
const BROADCAST_BATCH_SIZE = 500;

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
  // 신고 처리 알림의 대상 종류
  targetType?: ReportTargetType | null;
  // 운영정책 안내(policy_notice)에 붙는 제재 내용과 그때의 유효한 경고 수
  sanction?: SanctionNotice | null;
  warningCount?: number | null;
};

// 운영자가 가린 댓글의 알림 목록 내용
const BLINDED_COMMENT_CONTENT = '운영정책에 따라 삭제된 댓글이에요.';

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
    private readonly blockService: BlockService,
  ) {}

  /*
   * 알림 목록에 저장하고 푸시를 보낸다.
   * 받는 사람이 해당 알림을 꺼두었으면 목록에도 남기지 않는다. 운영 조치 안내(ALWAYS_DELIVERED_STATUSES)는 끌 수 없다.
   * 야간 알림을 꺼두었으면 밤에는 목록에만 남기고 푸시는 아침에 모아서 보낸다.
   * 받는 사람과 알림을 만든 사람(actor)이 차단 사이(누가 차단했든)면 목록에도 남기지 않는다.
   * 차단하기 전에 이미 남은 알림은 목록에 그대로 둔다.
   *
   * 편지/댓글 저장이 끝난 뒤 부르는 부가 작업이라, 실패해도 에러를 던지지 않고 로그만 남긴다.
   */
  async notify(input: CreateNotificationInput) {
    try {
      if (
        input.actorId &&
        Number(input.actorId) !== Number(input.userId) &&
        (await this.blockService.isBlockedBetween(input.userId, input.actorId))
      ) {
        return;
      }

      const settingKey = NOTIFICATION_SETTING_KEY_BY_STATUS[input.status];
      const enabled =
        ALWAYS_DELIVERED_STATUSES.has(input.status) ||
        (await this.isSettingEnabled(input.userId, settingKey));

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
          targetType: input.targetType ?? null,
          sanction: input.sanction ?? null,
          warningCount: input.warningCount ?? null,
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

  /*
   * 알림 목록에 남기지 않고 푸시만 보낸다. 이용 제한된 회원처럼 알림 목록을 볼 수 없는 사람에게 쓴다.
   * 목록 행이 없어서 야간에 미뤘다가 아침에 보낼 수 없으므로 바로 보낸다. 실패해도 에러를 던지지 않는다.
   */
  async sendPushOnly(
    userId: number,
    message: {
      title: string;
      body: string;
      data: Record<string, unknown>;
      settingKey: NotificationSettingKey;
    },
  ) {
    try {
      await this.sendToTokens(await this.getPushTokens(userId), {
        title: message.title,
        body: message.body,
        data: message.data,
        channelId: message.settingKey,
      });
    } catch (error) {
      this.logger.error(`푸시 발송 실패 (userId=${userId})`, error as Error);
    }
  }

  // userId 가 null 이면 로그인하지 않은 기기로 남긴다
  async registerPushToken(params: {
    userId: number | null;
    token: string;
    platform: string;
  }) {
    const { userId, token, platform } = params;

    if (!EXPO_PUSH_TOKEN_PATTERN.test(token)) {
      throw new BadRequestException('푸시 토큰 형식이 올바르지 않습니다.');
    }

    // 같은 기기에서 다른 계정으로 바꾸거나 로그아웃하면 토큰 주인만 바뀐다
    await this.pushTokenRepository.upsert(
      { userId, token, platform },
      { conflictPaths: ['token'] },
    );

    return { message: '푸시 토큰이 등록되었습니다.' };
  }

  // 내 계정에 등록된 토큰만 계정에서 뗀다. 로그인하지 않은 기기로 남아서 공지 푸시는 계속 받는다
  async detachPushToken(userId: number, token: string) {
    await this.pushTokenRepository.update({ userId, token }, { userId: null });

    return { message: '푸시 토큰이 계정에서 해제되었습니다.' };
  }

  /*
   * 공지(시스템 알림)를 모든 회원과 로그인하지 않은 기기에 보낸다. 서버에서 스크립트로 실행한다. (npm run notify:system)
   * 회원: notify 와 같은 규칙이다. 꺼둔 사람은 빼고, 목록에 남기고, 야간 알림을 끈 사람은 밤에 생긴 푸시를 아침으로 미룬다.
   * 로그인하지 않은 기기: 남길 목록이 없어서 푸시만 보낸다. 설정이 없으니 회원 기본값(켜짐 · 야간 켜짐)처럼 바로 보내고,
   * 끄려면 기기 알림 설정에서 끈다.
   * 광고성 정보(이벤트)는 수신 동의가 필요해서 로그인하지 않은 기기에는 보내지 않는다.
   */
  async broadcastSystemNotice() {
    const status = NotificationStatus.SYSTEM;
    const type = NOTIFICATION_TYPE_BY_STATUS[status];
    const settingKey = NOTIFICATION_SETTING_KEY_BY_STATUS[status];
    const isNight = isKstNightTime(new Date());

    // 이동할 원본이 없어서 종류만 넘긴다. 누르면 프론트가 알림 목록으로 보낸다.
    const message = {
      ...buildPushContent({ status }),
      data: { type, status },
      channelId: settingKey,
    };

    let memberCount = 0;
    let guestTokenCount = 0;

    for (let lastUserId = 0; ; ) {
      const users = await this.userRepository.find({
        select: { id: true },
        where: { id: MoreThan(lastUserId), withdrawnAt: IsNull() },
        order: { id: 'ASC' },
        take: BROADCAST_BATCH_SIZE,
      });

      if (users.length === 0) {
        break;
      }

      const userIds = users.map(({ id }) => Number(id));
      lastUserId = userIds[userIds.length - 1];

      const settingRows = await this.settingRepository.find({
        where: {
          userId: In(userIds),
          settingKey: In([settingKey, NotificationSettingKey.NIGHT]),
        },
      });
      const enabledByUserKey = new Map(
        settingRows.map((row) => [
          `${Number(row.userId)}:${row.settingKey}`,
          row.enabled,
        ]),
      );
      const isEnabled = (userId: number, key: NotificationSettingKey) =>
        enabledByUserKey.get(`${userId}:${key}`) ??
        NOTIFICATION_SETTING_DEFAULTS[key];

      const targetIds = userIds.filter((userId) =>
        isEnabled(userId, settingKey),
      );

      if (targetIds.length === 0) {
        continue;
      }

      // 아침으로 미룬 푸시는 sendPendingPushes 가 보낸다
      const laterIds = new Set(
        isNight
          ? targetIds.filter(
              (userId) => !isEnabled(userId, NotificationSettingKey.NIGHT),
            )
          : [],
      );

      await this.notificationRepository.insert(
        targetIds.map((userId) => ({
          userId,
          type,
          status,
          pushPending: laterIds.has(userId),
        })),
      );

      const nowIds = targetIds.filter((userId) => !laterIds.has(userId));

      if (nowIds.length > 0) {
        const tokenRows = await this.pushTokenRepository.find({
          select: { token: true },
          where: { userId: In(nowIds) },
        });

        await this.sendToTokens(
          tokenRows.map(({ token }) => token),
          message,
        );
      }

      memberCount += targetIds.length;
    }

    for (let lastTokenId = 0; ; ) {
      const tokenRows = await this.pushTokenRepository.find({
        select: { id: true, token: true },
        where: { id: MoreThan(lastTokenId), userId: IsNull() },
        order: { id: 'ASC' },
        take: BROADCAST_BATCH_SIZE,
      });

      if (tokenRows.length === 0) {
        break;
      }

      lastTokenId = Number(tokenRows[tokenRows.length - 1].id);

      await this.sendToTokens(
        tokenRows.map(({ token }) => token),
        message,
      );

      guestTokenCount += tokenRows.length;
    }

    return { memberCount, guestTokenCount };
  }

  async getNotifications(params: {
    userId: number;
    type?: NotificationType;
    cursor?: number;
    limit?: number;
  }) {
    const { userId, type, cursor } = params;
    const safeLimit = Math.min(Math.max(params.limit ?? 20, 1), 50);

    const qb = this.createVisibleNotificationQuery(userId)
      .leftJoinAndSelect('notification.actor', 'actor')
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
    const pageRows = hasNext ? rows.slice(0, safeLimit) : rows;
    const blindedCommentIds = await this.getBlindedCommentIds(pageRows);
    const items = pageRows.map((notification) =>
      this.formatNotificationItem(notification, blindedCommentIds),
    );
    const lastItem = items[items.length - 1];

    return {
      items,
      nextCursor: hasNext && lastItem ? lastItem.notificationId : null,
      hasNext,
    };
  }

  // 알림 화면을 마지막으로 나간 뒤에 목록에 보일 새 알림이 있는지. 종 아이콘 레드닷에 쓴다
  async hasUnreadNotification(userId: number) {
    const user = await this.userRepository.findOne({
      select: { id: true, notificationCheckedId: true },
      where: { id: userId },
    });

    if (!user) {
      return { hasUnread: false };
    }

    const unread = await this.createVisibleNotificationQuery(userId)
      .andWhere('notification.id > :checkedId', {
        checkedId: user.notificationCheckedId,
      })
      .select('notification.id')
      .getOne();

    return { hasUnread: Boolean(unread) };
  }

  /*
   * 알림 화면을 나갈 때 부른다. 알림마다 읽음을 따지지 않고 지금까지 온 알림을 모두 확인한 것으로 본다.
   * 기준은 그 시점의 가장 큰 알림 id 이고, 줄어들지는 않는다.
   */
  async checkNotifications(userId: number) {
    await this.userRepository.query(
      `UPDATE \`user\`
       SET notification_checked_id = GREATEST(
         notification_checked_id,
         COALESCE((SELECT MAX(id) FROM notification WHERE user_id = ?), 0)
       )
       WHERE id = ?`,
      [userId, userId],
    );

    return { hasUnread: false };
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
  // 목록에 보이는 알림 조건. 목록 조회와 레드닷이 같은 알림을 보도록 함께 쓴다
  private createVisibleNotificationQuery(userId: number) {
    return (
      this.notificationRepository
        .createQueryBuilder('notification')
        .where('notification.userId = :userId', { userId })
        // 정리 크론이 하루 밀려도 30일이 지난 알림은 보이지 않게 한 번 더 거른다
        .andWhere('notification.createdAt >= :since', {
          since: new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * DAY_MS),
        })
    );
  }

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

      // 밤사이 꺼둔 종류, 밤사이 차단 사이가 된 사람의 알림은 빼고 보낸다. 목록에는 이미 남아 있다.
      const [settings, blockedUserIds] = await Promise.all([
        this.getSettings(userId),
        this.blockService.getBlockedPairUserIds(userId),
      ]);
      const enabledKeys = new Set(
        settings.filter(({ enabled }) => enabled).map(({ key }) => key),
      );
      const blockedUserIdSet = new Set(blockedUserIds);
      const pushRows = rows.filter(
        (row) =>
          (ALWAYS_DELIVERED_STATUSES.has(row.status) ||
            enabledKeys.has(NOTIFICATION_SETTING_KEY_BY_STATUS[row.status])) &&
          !(row.actorId && blockedUserIdSet.has(Number(row.actorId))),
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
          select: {
            id: true,
            publicId: true,
            nickname: true,
            userCode: true,
            withdrawnAt: true,
          },
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
      actorNickname: actor ? getDisplayNickname(actor) : null,
      actorUserCode: actor?.userCode,
      recipientNickname: recipient?.nickname,
      isToSelf: this.isToSelf(notification),
      content: notification.content,
      eventTitle: notification.eventTitle,
      targetType: notification.targetType,
      sanction: notification.sanction,
      warningCount: notification.warningCount,
    });

    // 알림을 눌렀을 때 이동할 화면을 프론트가 고를 수 있게 넘긴다
    const data = {
      notificationId: Number(notification.id),
      type: notification.type,
      status: notification.status,
      letterId: this.toNullableNumber(notification.letterId),
      feedId: this.toNullableNumber(notification.feedId),
      commentId: this.toNullableNumber(notification.commentId),
      // 팔로우 알림을 누르면 그 사람 프로필로 간다. 탈퇴한 회원은 프로필이 없다.
      actorPublicId: actor && !isWithdrawnUser(actor) ? actor.publicId : null,
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

  /*
   * 알림이 가리키는 댓글 중 운영자가 가린 댓글 id.
   * 댓글 알림은 보낼 때 내용을 복사해 두므로, 나중에 가려진 댓글은 목록에서 내용만 바꿔 보여준다.
   * 삭제된 댓글이어도 가린 상태면 같은 문구를 보여주도록 withDeleted 로 찾는다
   */
  private async getBlindedCommentIds(notifications: NotificationEntity[]) {
    const commentIds = [
      ...new Set(
        notifications
          .map((notification) => notification.commentId)
          .filter((commentId): commentId is number => commentId !== null)
          .map(Number),
      ),
    ];

    if (commentIds.length === 0) {
      return new Set<number>();
    }

    const comments = await this.notificationRepository.manager
      .getRepository(FeedCommentEntity)
      .find({
        select: { id: true },
        where: { id: In(commentIds), blindedAt: Not(IsNull()) },
        withDeleted: true,
      });

    return new Set(comments.map((comment) => Number(comment.id)));
  }

  // NotificationListItem 이 받는 props 형태
  private formatNotificationItem(
    notification: NotificationEntity,
    blindedCommentIds: Set<number> = new Set(),
  ) {
    const isCommentBlinded =
      notification.commentId !== null &&
      blindedCommentIds.has(Number(notification.commentId));

    const { actor } = notification;
    const showsUserCode =
      notification.status === NotificationStatus.COMMENT ||
      notification.status === NotificationStatus.REPLY ||
      notification.status === NotificationStatus.FOLLOW;
    const isActorWithdrawn = !!actor && isWithdrawnUser(actor);

    return {
      notificationId: Number(notification.id),
      type: notification.type,
      status: notification.status,
      // 댓글/답글/팔로우는 아이디(userCode), 편지는 닉네임. 탈퇴한 회원은 아이디가 없어서 이름으로 보여준다.
      name: actor
        ? showsUserCode && !isActorWithdrawn
          ? actor.userCode
          : getDisplayNickname(actor)
        : null,
      // 팔로우 알림을 누르면 그 사람 프로필로 간다
      actorPublicId: actor?.publicId ?? null,
      isActorWithdrawn,
      profileImageUrl: actor ? this.r2Service.getProfileImageUrl(actor) : null,
      // 운영자가 가린 댓글의 알림은 남겨 두고 내용만 바꾼다
      content: isCommentBlinded
        ? BLINDED_COMMENT_CONTENT
        : notification.content,
      eventTitle: notification.eventTitle,
      // 신고 처리 알림의 대상 종류 (FEED / COMMENT / LETTER / USER)
      targetType: notification.targetType,
      // 운영정책 안내의 제재 내용(SanctionNotice: WARNING / SUSPENSION / PERMANENT)과 그때의 유효한 경고 수
      sanction: notification.sanction,
      warningCount: notification.warningCount,
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
