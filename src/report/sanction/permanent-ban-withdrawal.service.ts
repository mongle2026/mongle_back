import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { WithdrawalService } from '../../auth/withdrawal.service';
import { ReportDiscordService } from '../discord/report-discord.service';
import { AppealStatus } from '../appeal/entities/restriction-appeal.entity';
import { ReportTargetType } from '../enums/report.enum';
import {
  PERMANENT_APPEAL_DAYS,
  SanctionRestriction,
  addDays,
} from './sanction.constants';

// 한 번 실행에서 탈퇴시킬 최대 회원 수. 남은 회원은 다음 실행(다음 날)에 이어서 한다
const MAX_USERS_PER_RUN = 100;

type Candidate = {
  id: string;
  target_type: ReportTargetType | null;
  target_id: string | null;
};

/*
 * 영구 정지된 회원을 이의 신청 기간(제한 후 PERMANENT_APPEAL_DAYS 일)이 끝나면 매일 자동으로 탈퇴시킨다.
 * 운영자가 [탈퇴시키기] 를 누를 때와 같은 처리를 한다 (WithdrawalService.forceWithdraw):
 * 같은 소셜 계정으로 1년 동안 다시 가입할 수 없고, 회원에게 알림을 보내지 않으며, 되돌릴 수 없다.
 *
 * 이 제한에 검토 중인 이의 신청이 있으면 처리될 때까지 기다린다.
 * 받아들이면 제한이 풀려 탈퇴시키지 않고, 기각하면 다음 실행에 탈퇴시킨다 (기간이 끝나 다시 신청할 수 없다).
 * 신고 정리(moderation-retention.service.ts, 이의 신청 기간이 끝나고 REPORT_PURGE_GRACE_DAYS 일 뒤)보다 먼저 돈다.
 */
@Injectable()
export class PermanentBanWithdrawalService {
  private readonly logger = new Logger(PermanentBanWithdrawalService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly withdrawalService: WithdrawalService,
    private readonly reportDiscordService: ReportDiscordService,
  ) {}

  @Cron('0 10 4 * * *', { timeZone: 'Asia/Seoul' })
  async handleAutoWithdrawal() {
    const now = new Date();
    let candidates: Candidate[];

    try {
      candidates = await this.findCandidates(now);
    } catch (error) {
      this.logError('자동 탈퇴할 영구 정지 회원 조회 실패', error);
      return;
    }

    let withdrawnCount = 0;

    for (const candidate of candidates) {
      const userId = Number(candidate.id);

      try {
        // 회원 행을 잠근 뒤 조건을 다시 확인한다. 그 사이 상태가 바뀌었으면 false
        if (
          !(await this.withdrawalService.withdrawAfterAppealPeriod(userId, now))
        ) {
          continue;
        }

        withdrawnCount++;
      } catch (error) {
        this.logError(
          `영구 정지 회원 자동 탈퇴 실패 (userId=${userId})`,
          error,
        );
        continue;
      }

      // 신고 메시지의 제재 상태를 '탈퇴함'으로 고치고 [탈퇴시키기] 버튼을 뗀다 (실패해도 예외를 던지지 않는다)
      if (candidate.target_type && candidate.target_id) {
        await this.reportDiscordService.syncMessages(
          candidate.target_type,
          Number(candidate.target_id),
          userId,
        );
      }
    }

    if (withdrawnCount > 0) {
      this.logger.log(
        `이의 신청 기간이 끝난 영구 정지 회원 ${withdrawnCount}명 자동 탈퇴`,
      );
    }
  }

  /*
   * 탈퇴하지 않았고, 영구 정지된 지 PERMANENT_APPEAL_DAYS 일이 지났고, 이 제한에 검토 중인 이의 신청이 없는 회원.
   * 디스코드 메시지를 고칠 수 있게 이 영구 정지를 내린 신고 대상도 함께 찾는다 (없으면 null)
   */
  private async findCandidates(now: Date): Promise<Candidate[]> {
    const restrictedBefore = addDays(now, -PERMANENT_APPEAL_DAYS);

    return await this.dataSource.query(
      `SELECT u.id, s.target_type, s.target_id
         FROM \`user\` u
         LEFT JOIN user_sanction s
           ON s.id = (
             SELECT s2.id FROM user_sanction s2
              WHERE s2.user_id = u.id
                AND s2.restriction = ?
                AND s2.restricted_at = u.restricted_at
                AND s2.revoked_at IS NULL
              ORDER BY s2.id DESC
              LIMIT 1
           )
        WHERE u.withdrawn_at IS NULL
          AND u.restricted_at IS NOT NULL
          AND u.restricted_until IS NULL
          AND u.restricted_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM restriction_appeal a
             WHERE a.user_id = u.id
               AND a.restricted_at = u.restricted_at
               AND a.status = ?
          )
        ORDER BY u.id
        LIMIT ?`,
      [
        SanctionRestriction.PERMANENT,
        restrictedBefore,
        AppealStatus.PENDING,
        MAX_USERS_PER_RUN,
      ],
    );
  }

  private logError(message: string, error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.error(`${message}: ${detail}`);
  }
}
