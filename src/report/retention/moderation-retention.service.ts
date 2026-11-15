import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource, In, LessThanOrEqual, MoreThan, Not } from 'typeorm';
import { ReportEntity } from '../entities/report.entity';
import { ReportStatus } from '../enums/report.enum';
import {
  AppealStatus,
  RestrictionAppealEntity,
} from '../appeal/entities/restriction-appeal.entity';
import { UserSanctionEntity } from '../sanction/entities/user-sanction.entity';
import {
  addDays,
  addMonths,
  PERMANENT_APPEAL_DAYS,
} from '../sanction/sanction.constants';
import { UserEntity } from '../../user/entities/user.entity';
import { BannedAccountEntity } from '../../auth/entities/banned-account.entity';
import { DiscordApiService } from '../discord/discord-api.service';
import {
  MODERATION_RECORD_RETENTION_MONTHS,
  REPORT_PURGE_GRACE_DAYS,
} from './retention.constants';

const BATCH_SIZE = 200;
// 한 번 실행에서 처리할 최대 묶음 수. 남은 기록은 다음 실행(다음 날)에 이어서 지운다
const MAX_BATCHES_PER_RUN = 50;

type DiscordChannel = 'report' | 'appeal';

/*
 * 개인정보처리방침의 보관 기간이 지난 신고 · 제재 기록을 매일 지운다 (retention.constants.ts).
 * 신고자 · 신고당한 회원이 탈퇴했어도 같은 기준으로 보관하고 지운다.
 *
 * - 신고(report): 처리가 끝나고, 신고당한 회원의 이의 제기 절차도 끝난 뒤 REPORT_PURGE_GRACE_DAYS 일이 지나면.
 *   이의 제기 절차가 남은 동안은 그 회원의 신고를 모두 남긴다:
 *   기간 정지는 정지가 끝날 때까지, 영구 정지는 제한 후 PERMANENT_APPEAL_DAYS 일까지 이의 신청할 수 있고,
 *   검토 중인 이의 신청이 있으면 처리될 때까지 기다린다.
 *   신고 내용이 복사된 디스코드 신고 메시지도 함께 지운다. 지운 신고는 되돌리기(undo)할 수 없다.
 * - 이의 신청(restriction_appeal): 처리 후 1년. 디스코드 이의 신청 메시지도 함께 지운다
 * - 회원의 이용 제한 기록(user.restricted_*): 기간 정지는 끝난 지 1년, 영구 정지는 탈퇴 후 1년
 * - 제재 이력(user_sanction): 부여(되돌렸으면 되돌린 때) 후 1년. 아직 이어지는 이용 제한을 내린 제재는 남긴다
 * - 재가입 제한(banned_account): expires_at 이 지나면
 */
@Injectable()
export class ModerationRetentionService {
  private readonly logger = new Logger(ModerationRetentionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly discordApiService: DiscordApiService,
  ) {}

  @Cron('0 20 4 * * *', { timeZone: 'Asia/Seoul' })
  async handleRetentionCleanup() {
    const now = new Date();
    // 이용 제한 기록이 제재 이력보다 먼저 지워져야, 같은 날 그 제한을 내린 제재도 지울 수 있다
    const steps: [string, () => Promise<number>][] = [
      ['신고', () => this.purgeReports(now)],
      ['이의 신청', () => this.purgeAppeals(now)],
      ['회원 이용 제한 기록', () => this.clearUserRestrictions(now)],
      ['제재 이력', () => this.purgeSanctions(now)],
      ['재가입 제한', () => this.purgeBannedAccounts(now)],
    ];

    for (const [label, run] of steps) {
      try {
        const count = await run();

        if (count > 0) {
          this.logger.log(`보관 기간이 지난 ${label} ${count}건 정리`);
        }
      } catch (error) {
        this.logError(`보관 기간이 지난 ${label} 정리 실패`, error);
      }
    }
  }

  async purgeReports(now: Date) {
    // 이 시각 전에 끝난 절차만 지운다
    const endedBefore = addDays(now, -REPORT_PURGE_GRACE_DAYS);
    // 영구 정지가 이 시각 뒤에 내려졌으면 아직 이의 신청 기간이 끝난 지 REPORT_PURGE_GRACE_DAYS 일이 안 됐다
    const permanentRestrictedAfter = addDays(
      endedBefore,
      -PERMANENT_APPEAL_DAYS,
    );
    let lastId = 0;
    let purgedCount = 0;

    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const rows: { id: string; discord_message_id: string | null }[] =
        await this.dataSource.query(
          `SELECT r.id, r.discord_message_id
             FROM report r
            WHERE r.id > ?
              AND r.status <> ?
              AND r.handled_at <= ?
              AND NOT EXISTS (
                SELECT 1 FROM \`user\` u
                 WHERE u.id = r.reported_user_id
                   AND u.restricted_at IS NOT NULL
                   AND (u.restricted_until > ?
                        OR (u.restricted_until IS NULL AND u.restricted_at > ?))
              )
              AND NOT EXISTS (
                SELECT 1 FROM restriction_appeal a
                 WHERE a.user_id = r.reported_user_id
                   AND (a.status = ? OR a.handled_at > ?)
              )
            ORDER BY r.id
            LIMIT ?`,
          [
            lastId,
            ReportStatus.PENDING,
            endedBefore,
            endedBefore,
            permanentRestrictedAfter,
            AppealStatus.PENDING,
            endedBefore,
            BATCH_SIZE,
          ],
        );

      if (rows.length === 0) {
        break;
      }

      lastId = Number(rows[rows.length - 1].id);
      const ids: number[] = [];

      for (const row of rows) {
        if (
          await this.deleteDiscordMessage(
            'report',
            row.discord_message_id,
            `신고 #${row.id}`,
          )
        ) {
          ids.push(Number(row.id));
        }
      }

      if (ids.length > 0) {
        // 고르는 사이 되돌리기(undo)로 처리 전이 된 신고는 남긴다
        const { affected } = await this.dataSource
          .getRepository(ReportEntity)
          .delete({ id: In(ids), status: Not(ReportStatus.PENDING) });

        purgedCount += affected ?? 0;
      }

      if (rows.length < BATCH_SIZE) {
        break;
      }
    }

    return purgedCount;
  }

  async purgeAppeals(now: Date) {
    const handledBefore = addMonths(now, -MODERATION_RECORD_RETENTION_MONTHS);
    const repository = this.dataSource.getRepository(RestrictionAppealEntity);
    let lastId = 0;
    let purgedCount = 0;

    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const appeals = await repository.find({
        select: { id: true, discordMessageId: true },
        where: {
          id: MoreThan(lastId),
          status: Not(AppealStatus.PENDING),
          handledAt: LessThanOrEqual(handledBefore),
        },
        order: { id: 'ASC' },
        take: BATCH_SIZE,
      });

      if (appeals.length === 0) {
        break;
      }

      lastId = Number(appeals[appeals.length - 1].id);
      const ids: number[] = [];

      for (const appeal of appeals) {
        if (
          await this.deleteDiscordMessage(
            'appeal',
            appeal.discordMessageId,
            `이의 신청 #${appeal.id}`,
          )
        ) {
          ids.push(Number(appeal.id));
        }
      }

      if (ids.length > 0) {
        const { affected } = await repository.delete({ id: In(ids) });
        purgedCount += affected ?? 0;
      }

      if (appeals.length < BATCH_SIZE) {
        break;
      }
    }

    return purgedCount;
  }

  // 회원 행은 탈퇴해도 남으므로 지난 이용 제한 값만 비운다
  async clearUserRestrictions(now: Date) {
    const endedBefore = addMonths(now, -MODERATION_RECORD_RETENTION_MONTHS);
    const repository = this.dataSource.getRepository(UserEntity);
    const cleared = {
      restrictedAt: null,
      restrictedUntil: null,
      restrictedReason: null,
    };

    // 기간 정지: 끝난 지 1년
    const ended = await repository.update(
      { restrictedUntil: LessThanOrEqual(endedBefore) },
      cleared,
    );

    // 영구 정지 · 해제 안내: 탈퇴 후 1년 (탈퇴하지 않은 영구 정지 회원은 제한이 이어지고 있어서 남긴다)
    const withdrawn = await repository
      .createQueryBuilder()
      .update()
      .set({ ...cleared, restrictionLiftReason: null })
      .where('withdrawn_at <= :endedBefore', { endedBefore })
      .andWhere(
        '(restricted_at IS NOT NULL OR restriction_lift_reason IS NOT NULL)',
      )
      .execute();

    return (ended.affected ?? 0) + (withdrawn.affected ?? 0);
  }

  async purgeSanctions(now: Date) {
    const handledBefore = addMonths(now, -MODERATION_RECORD_RETENTION_MONTHS);
    let purgedCount = 0;

    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const rows: { id: string }[] = await this.dataSource.query(
        `SELECT s.id
           FROM user_sanction s
          WHERE COALESCE(s.revoked_at, s.created_at) <= ?
            AND NOT EXISTS (
              SELECT 1 FROM \`user\` u
               WHERE u.id = s.user_id
                 AND s.restriction IS NOT NULL
                 AND s.revoked_at IS NULL
                 AND u.restricted_at = s.restricted_at
                 AND (u.restricted_until IS NULL OR u.restricted_until > ?)
            )
          ORDER BY s.id
          LIMIT ?`,
        [handledBefore, now, BATCH_SIZE],
      );

      if (rows.length === 0) {
        break;
      }

      const { affected } = await this.dataSource
        .getRepository(UserSanctionEntity)
        .delete({ id: In(rows.map(({ id }) => Number(id))) });

      purgedCount += affected ?? 0;

      if (rows.length < BATCH_SIZE) {
        break;
      }
    }

    return purgedCount;
  }

  async purgeBannedAccounts(now: Date) {
    const { affected } = await this.dataSource
      .getRepository(BannedAccountEntity)
      .delete({ expiresAt: LessThanOrEqual(now) });

    return affected ?? 0;
  }

  /*
   * 지웠거나 지울 메시지가 없으면 true. 지우지 못했으면 false 라서 DB 행을 남기고 다음 날 다시 시도한다.
   * 봇 설정이 없어 지울 수 없으면 DB 행은 지우고 운영자가 직접 지우도록 로그를 남긴다.
   * (웹훅으로 보낸 메시지는 id 가 없어서 여기서 지울 수 없다)
   */
  private async deleteDiscordMessage(
    channel: DiscordChannel,
    messageId: string | null,
    label: string,
  ) {
    if (!messageId) {
      return true;
    }

    const isConfigured =
      channel === 'report'
        ? this.discordApiService.isBotConfigured()
        : this.discordApiService.isAppealBotConfigured();

    if (!isConfigured) {
      this.logger.warn(
        `${label} 디스코드 메시지(${messageId})는 봇 설정이 없어 지우지 못했어요. 직접 지워 주세요.`,
      );
      return true;
    }

    try {
      if (channel === 'report') {
        await this.discordApiService.deleteReportMessage(messageId);
      } else {
        await this.discordApiService.deleteAppealMessage(messageId);
      }

      return true;
    } catch (error) {
      this.logError(`${label} 디스코드 메시지 삭제 실패`, error);
      return false;
    }
  }

  // 에러 객체에는 봇 토큰이 들어 있어서 메시지만 남긴다
  private logError(message: string, error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.error(`${message}: ${detail}`);
  }
}
