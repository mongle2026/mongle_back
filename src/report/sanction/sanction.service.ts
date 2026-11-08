import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, MoreThan } from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import {
  isPermanentlyRestrictedUser,
  isRestrictedUser,
  isWithdrawnUser,
} from '../../user/withdrawn-user';
import { ReportEntity } from '../entities/report.entity';
import { ReportTargetType } from '../enums/report.enum';
import { UserSanctionEntity } from './entities/user-sanction.entity';
import {
  addDays,
  addMonths,
  PERMANENT_WARNING_COUNT,
  SanctionNotice,
  SanctionRestriction,
  SanctionType,
  SUSPENSION_DAYS,
  SUSPENSION_WARNING_COUNT,
  WARNING_EXPIRY_MONTHS,
} from './sanction.constants';

// 제재에 필요한 회원 값. 같은 트랜잭션 안에서 제한을 바꾸면 이 객체도 같이 고친다
export type SanctionUser = Pick<
  UserEntity,
  'id' | 'withdrawnAt' | 'restrictedAt' | 'restrictedUntil' | 'restrictedReason'
>;

export type SanctionResult = {
  // 신고당한 회원에게 보낼 안내 종류
  notice: SanctionNotice;
  // 경고를 준 뒤의 유효한 경고 수. 영구 정지(BAN)면 null
  warningCount: number | null;
  // 이번에 바뀐 이용 제한. 바뀌지 않았으면 null
  restriction: SanctionRestriction | null;
  // 이번에 바뀐 제한이 끝나는 시각. 영구 정지거나 바뀌지 않았으면 null
  restrictedUntil: Date | null;
};

// 디스코드 신고 메시지에 보여주는 신고당한 회원의 지금 제재 상태
export type UserSanctionState = {
  warningCount: number;
  isWithdrawn: boolean;
  isRestricted: boolean;
  isPermanent: boolean;
  restrictedUntil: Date | null;
};

type AppliedRestriction = Pick<
  UserSanctionEntity,
  | 'restriction'
  | 'restrictedAt'
  | 'restrictedUntil'
  | 'prevRestrictedAt'
  | 'prevRestrictedUntil'
  | 'prevRestrictedReason'
>;

const NO_RESTRICTION_CHANGE: AppliedRestriction = {
  restriction: null,
  restrictedAt: null,
  restrictedUntil: null,
  prevRestrictedAt: null,
  prevRestrictedUntil: null,
  prevRestrictedReason: null,
};

const isSameTime = (a: Date | null, b: Date | null) =>
  (a === null && b === null) ||
  (a !== null && b !== null && new Date(a).getTime() === new Date(b).getTime());

/*
 * 신고 처리로 내리는 경고 · 영구 정지 (sanction.constants.ts 규칙).
 * 신고 처리(ReportModerationService)의 트랜잭션 안에서 부르고, 회원 행은 부르는 쪽에서 lockUser 로 잠근다.
 *
 * 이용 제한은 지금보다 무거울 때만 바꾼다 (영구 > 끝나는 시각이 더 늦은 정지).
 * 제한을 바꿀 때마다 restricted_at 을 새로 채워서 새 제한으로 본다 (이전 제한에 낸 이의 신청은 닫힌다).
 */
@Injectable()
export class SanctionService {
  constructor(private readonly dataSource: DataSource) {}

  async lockUser(
    manager: EntityManager,
    userId: number,
  ): Promise<SanctionUser | null> {
    return await manager.findOne(UserEntity, {
      select: {
        id: true,
        withdrawnAt: true,
        restrictedAt: true,
        restrictedUntil: true,
        restrictedReason: true,
      },
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  // 경고 1회를 주고, 쌓인 경고 수에 따라 7일 정지 · 영구 정지를 내린다
  async issueWarning(
    manager: EntityManager,
    user: SanctionUser,
    report: ReportEntity,
    handledBy: string | null,
    now: Date,
  ): Promise<SanctionResult> {
    const sanction = await manager.save(
      manager.create(UserSanctionEntity, {
        userId: Number(user.id),
        type: SanctionType.WARNING,
        reportId: Number(report.id),
        targetType: report.targetType,
        targetId: Number(report.targetId),
        reason: report.reason,
        expiresAt: addMonths(now, WARNING_EXPIRY_MONTHS),
        handledBy,
        ...NO_RESTRICTION_CHANGE,
      }),
    );

    const warningCount = await this.countActiveWarnings(
      Number(user.id),
      now,
      manager,
    );

    const restriction =
      warningCount >= PERMANENT_WARNING_COUNT
        ? SanctionRestriction.PERMANENT
        : warningCount >= SUSPENSION_WARNING_COUNT
          ? SanctionRestriction.SUSPENSION
          : null;

    const applied = restriction
      ? await this.applyRestriction(manager, user, restriction, report, now)
      : NO_RESTRICTION_CHANGE;

    if (applied.restriction) {
      await manager.update(UserSanctionEntity, { id: sanction.id }, applied);
    }

    return {
      notice:
        applied.restriction === SanctionRestriction.PERMANENT
          ? SanctionNotice.PERMANENT
          : applied.restriction === SanctionRestriction.SUSPENSION
            ? SanctionNotice.SUSPENSION
            : SanctionNotice.WARNING,
      warningCount,
      restriction: applied.restriction,
      restrictedUntil: applied.restrictedUntil,
    };
  }

  // 경고 횟수와 관계없이 바로 영구 정지. 이미 영구 정지 중이면 기록만 남긴다
  async ban(
    manager: EntityManager,
    user: SanctionUser,
    report: ReportEntity,
    handledBy: string | null,
    now: Date,
  ): Promise<SanctionResult> {
    const applied = await this.applyRestriction(
      manager,
      user,
      SanctionRestriction.PERMANENT,
      report,
      now,
    );

    await manager.save(
      manager.create(UserSanctionEntity, {
        userId: Number(user.id),
        type: SanctionType.BAN,
        reportId: Number(report.id),
        targetType: report.targetType,
        targetId: Number(report.targetId),
        reason: report.reason,
        expiresAt: null,
        handledBy,
        ...applied,
      }),
    );

    return {
      notice: SanctionNotice.PERMANENT,
      warningCount: null,
      restriction: applied.restriction,
      restrictedUntil: null,
    };
  }

  /*
   * 신고 처리를 되돌릴 때 그 대상으로 내린 제재를 모두 없앤다. 최근 제재부터 하나씩 되돌린다.
   * 제재가 바꾼 이용 제한이 아직 그대로면 제재 전 상태로 돌린다.
   * (그 사이 이의 신청 · 다른 제재로 제한이 바뀌었으면 그대로 둔다)
   * 없앤 제재 수를 돌려준다.
   */
  async revokeForTarget(
    manager: EntityManager,
    targetType: ReportTargetType,
    targetId: number,
    now: Date,
  ) {
    const sanctions = await manager.find(UserSanctionEntity, {
      where: { targetType, targetId, revokedAt: IsNull() },
      order: { id: 'DESC' },
    });

    const users = new Map<number, SanctionUser | null>();

    for (const sanction of sanctions) {
      const userId = Number(sanction.userId);

      if (!users.has(userId)) {
        users.set(userId, await this.lockUser(manager, userId));
      }

      const user = users.get(userId);

      if (
        user &&
        sanction.restriction &&
        isSameTime(user.restrictedAt, sanction.restrictedAt) &&
        isSameTime(user.restrictedUntil, sanction.restrictedUntil)
      ) {
        const previous = {
          restrictedAt: sanction.prevRestrictedAt,
          restrictedUntil: sanction.prevRestrictedUntil,
          restrictedReason: sanction.prevRestrictedReason,
        };

        await manager.update(UserEntity, { id: userId }, previous);
        Object.assign(user, previous);
      }

      await manager.update(
        UserSanctionEntity,
        { id: sanction.id },
        { revokedAt: now },
      );
    }

    return sanctions.length;
  }

  async countActiveWarnings(
    userId: number,
    now = new Date(),
    manager: EntityManager = this.dataSource.manager,
  ) {
    return await manager.count(UserSanctionEntity, {
      where: {
        userId,
        type: SanctionType.WARNING,
        revokedAt: IsNull(),
        expiresAt: MoreThan(now),
      },
    });
  }

  async getUserState(userId: number): Promise<UserSanctionState | null> {
    const user = await this.dataSource.getRepository(UserEntity).findOne({
      select: {
        id: true,
        withdrawnAt: true,
        restrictedAt: true,
        restrictedUntil: true,
      },
      where: { id: userId },
    });

    if (!user) {
      return null;
    }

    const isRestricted = isRestrictedUser(user);

    return {
      warningCount: await this.countActiveWarnings(userId),
      isWithdrawn: isWithdrawnUser(user),
      isRestricted,
      isPermanent: isPermanentlyRestrictedUser(user),
      restrictedUntil: isRestricted ? user.restrictedUntil : null,
    };
  }

  // 지금 제한보다 무거울 때만 바꾸고, 바꾼 값과 바꾸기 전 값을 돌려준다
  private async applyRestriction(
    manager: EntityManager,
    user: SanctionUser,
    restriction: SanctionRestriction,
    report: ReportEntity,
    now: Date,
  ): Promise<AppliedRestriction> {
    const wasRestricted = isRestrictedUser(user, now);
    const restrictedUntil =
      restriction === SanctionRestriction.PERMANENT
        ? null
        : addDays(now, SUSPENSION_DAYS);

    if (
      wasRestricted &&
      (!user.restrictedUntil ||
        (restrictedUntil && restrictedUntil <= user.restrictedUntil))
    ) {
      return NO_RESTRICTION_CHANGE;
    }

    const applied: AppliedRestriction = {
      restriction,
      restrictedAt: now,
      restrictedUntil,
      prevRestrictedAt: wasRestricted ? user.restrictedAt : null,
      prevRestrictedUntil: wasRestricted ? user.restrictedUntil : null,
      prevRestrictedReason: wasRestricted ? user.restrictedReason : null,
    };

    const next = {
      restrictedAt: now,
      restrictedUntil,
      restrictedReason: report.reason,
    };

    await manager.update(UserEntity, { id: user.id }, next);
    Object.assign(user, next);

    return applied;
  }
}
