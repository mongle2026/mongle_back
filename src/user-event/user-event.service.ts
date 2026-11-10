import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { UserEventEntity } from './entities/user-event.entity';
import { ServerUserEventType, UserEventType } from './enums/user-event.enum';
import { ClientUserEventDto } from './dto/create-user-events.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

// 이 기간이 지난 기록은 크론이 지운다
export const USER_EVENT_RETENTION_DAYS = 90;

// 앱 시계가 틀렸거나 오래 못 보낸 이벤트: 이보다 오래된 시각은 이 시각으로 맞춘다
const CLIENT_OCCURRED_AT_MAX_AGE_MS = 7 * DAY_MS;

// 정리 크론이 한 번에 지우는 최대 줄 수
const PURGE_BATCH = 5000;

@Injectable()
export class UserEventService {
  private readonly logger = new Logger(UserEventService.name);

  constructor(private readonly dataSource: DataSource) { }

  /**
   * 서버에서 일어난 일(좋아요 · 북마크와 취소)을 남긴다.
   * 기록은 부가 기능이라 실패해도 원래 요청(좋아요 등)은 성공으로 둔다. 그래서 트랜잭션이 끝난 뒤에 부르고 기다리지 않는다
   */
  recordServerEvent(params: {
    userId: number;
    type: ServerUserEventType;
    feedId: number;
  }) {
    const occurredAt = new Date();

    void this.dataSource
      .query(
        `INSERT INTO user_event (user_id, event_type, feed_id, music_id, occurred_at)
         SELECT ?, ?, f.id, r.music_id, ?
           FROM feed f
           INNER JOIN record r ON r.id = f.record_id
          WHERE f.id = ?`,
        [params.userId, params.type, occurredAt, params.feedId],
      )
      .catch(error => {
        this.logger.warn(
          `행동 기록 저장 실패 (${params.type}, userId=${params.userId}, feedId=${params.feedId}): ${String(error)}`,
        );
      });
  }

  /**
   * 앱이 모아서 보낸 이벤트 (POST /events). 없는 글에 대한 이벤트는 버린다.
   * 지워진 글이라도 기록은 남긴다 (상세를 보던 중에 글이 지워질 수 있다)
   */
  async recordClientEvents(userId: number, events: ClientUserEventDto[]) {
    const feedIds = [...new Set(events.map(event => event.feedId))];
    const rows = (await this.dataSource.query(
      `SELECT f.id AS feedId, r.music_id AS musicId
         FROM feed f
         INNER JOIN record r ON r.id = f.record_id
        WHERE f.id IN (?)`,
      [feedIds],
    )) as { feedId: string; musicId: string }[];

    const musicIdByFeedId = new Map(rows.map(row => [Number(row.feedId), Number(row.musicId)]));
    const now = Date.now();

    const values = events
      .filter(event => musicIdByFeedId.has(event.feedId))
      .map(event => {
        const isListen = event.type === UserEventType.MUSIC_LISTEN;

        return {
          userId,
          eventType: event.type,
          feedId: event.feedId,
          musicId: musicIdByFeedId.get(event.feedId) ?? null,
          durationMs: event.durationMs,
          positionMs: isListen ? event.positionMs ?? null : null,
          detail: isListen ? event.endReason ?? null : null,
          occurredAt: this.clampOccurredAt(event.occurredAt, now),
        };
      });

    if (values.length > 0) {
      await this.dataSource
        .createQueryBuilder()
        .insert()
        .into(UserEventEntity)
        .values(values)
        .updateEntity(false)
        .execute();
    }

    return { savedCount: values.length };
  }

  // 보관 기간이 지난 기록 정리. 다른 정리 크론(03:00~04:50)과 겹치지 않게 05:10 에 돈다
  @Cron('0 10 5 * * *', { timeZone: 'Asia/Seoul' })
  async purgeOldEvents() {
    const cutoff = new Date(Date.now() - USER_EVENT_RETENTION_DAYS * DAY_MS);

    for (let batch = 0; batch < 50; batch++) {
      const result = (await this.dataSource.query(
        'DELETE FROM user_event WHERE occurred_at < ? LIMIT ?',
        [cutoff, PURGE_BATCH],
      )) as { affectedRows?: number };

      if ((result.affectedRows ?? 0) < PURGE_BATCH) break;
    }
  }

  // 앱 시각은 믿지 않고 [지금 - 7일, 지금] 안으로 맞춘다
  private clampOccurredAt(value: string, now: number) {
    const time = new Date(value).getTime();

    if (!Number.isFinite(time)) return new Date(now);

    return new Date(Math.min(now, Math.max(now - CLIENT_OCCURRED_AT_MAX_AGE_MS, time)));
  }
}
