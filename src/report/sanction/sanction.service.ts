import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThan,
  Not,
  Or,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import {
  getPendingRestrictionLift,
  isPermanentlyRestrictedUser,
  isRestrictedUser,
  isWithdrawnUser,
} from '../../user/withdrawn-user';
import { ReportEntity } from '../entities/report.entity';
import { ReportReason, ReportTargetType } from '../enums/report.enum';
import { UserSanctionEntity } from './entities/user-sanction.entity';
import { RestrictionAppealEntity } from '../appeal/entities/restriction-appeal.entity';
import {
  addDays,
  addMonths,
  getAppealDeadline,
  PERMANENT_WARNING_COUNT,
  RestrictionLiftReason,
  SanctionNotice,
  SanctionRestriction,
  SanctionType,
  SUSPENSION_DAYS,
  SUSPENSION_WARNING_COUNT,
  WARNING_EXPIRY_MONTHS,
} from './sanction.constants';
import { PERMANENT_REJOIN_BAN_MONTHS } from '../retention/retention.constants';
import { getReportPreview } from '../report-preview.util';
import { R2Service } from '../../storage/r2.service';
import { FeedEntity } from '../../feed/entities/feed.entity';
import { RecordEntity } from '../../record/entities/record.entity';

// 제재에 필요한 회원 값. 같은 트랜잭션 안에서 제한을 바꾸면 이 객체도 같이 고친다
export type SanctionUser = Pick<
  UserEntity,
  | 'id'
  | 'withdrawnAt'
  | 'restrictedAt'
  | 'restrictedUntil'
  | 'restrictedReason'
  | 'restrictionLiftReason'
  | 'restrictionLiftAcknowledgedAt'
>;

export type SanctionResult = {
  // 이번에 남긴 제재(user_sanction.id). 운영정책 안내 알림에 붙여서 상세 화면에서 조회한다
  sanctionId: number;
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
  constructor(
    private readonly dataSource: DataSource,
    private readonly r2Service: R2Service,
  ) {}

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
        restrictionLiftReason: true,
        restrictionLiftAcknowledgedAt: true,
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
        contentPreview: getReportPreview(
          report.targetType,
          report.contentSnapshot,
        ),
        targetUserId: await this.findTargetUserId(manager, report),
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
      sanctionId: Number(sanction.id),
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

    const sanction = await manager.save(
      manager.create(UserSanctionEntity, {
        userId: Number(user.id),
        type: SanctionType.BAN,
        reportId: Number(report.id),
        targetType: report.targetType,
        targetId: Number(report.targetId),
        reason: report.reason,
        contentPreview: getReportPreview(
          report.targetType,
          report.contentSnapshot,
        ),
        targetUserId: await this.findTargetUserId(manager, report),
        expiresAt: null,
        handledBy,
        ...applied,
      }),
    );

    return {
      sanctionId: Number(sanction.id),
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
   * 되돌려서 제한이 없어지면, 앱이 풀린 뒤 처음 들어올 때 해제 안내(REVOKED)를 띄운다
   * reportIds 를 주면 그 신고로 내린 제재만 없앤다 (회원 신고는 처리할 때마다 경고가 쌓여서 한 번의 처리만 되돌린다)
   * 없앤 제재 수를 돌려준다.
   */
  async revokeForTarget(
    manager: EntityManager,
    targetType: ReportTargetType,
    targetId: number,
    now: Date,
    reportIds?: number[],
  ) {
    if (reportIds?.length === 0) {
      return 0;
    }

    const sanctions = await manager.find(UserSanctionEntity, {
      where: {
        targetType,
        targetId,
        revokedAt: IsNull(),
        ...(reportIds && { reportId: In(reportIds) }),
      },
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
        // 제한 중이었거나, 기간이 끝났는데 아직 해제 안내를 확인하지 않았으면 다시 안내한다
        const hasLiftToNotice =
          isRestrictedUser(user, now) ||
          getPendingRestrictionLift(user, now) !== null;

        const previous = {
          restrictedAt: sanction.prevRestrictedAt,
          restrictedUntil: sanction.prevRestrictedUntil,
          restrictedReason: sanction.prevRestrictedReason,
          restrictionLiftReason:
            !sanction.prevRestrictedAt && hasLiftToNotice
              ? RestrictionLiftReason.REVOKED
              : null,
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

  /*
   * 지금 이용 제한 상태. 앱의 제재 화면이 앱으로 돌아올 때 · 푸시를 받을 때 다시 확인하려고 부른다.
   * 제한 중이 아니면 { isRestricted: false, restrictionLift } 를 준다.
   * restrictionLift: 아직 확인하지 않은 해제 안내({ reason }). 없으면 null
   * appealStatus: 이 제한에 낸 마지막 이의 신청의 상태. 안 냈으면 null
   */
  async getRestriction(userId: number) {
    const user = await this.dataSource.getRepository(UserEntity).findOne({
      select: {
        id: true,
        restrictedAt: true,
        restrictedUntil: true,
        restrictedReason: true,
        restrictionLiftReason: true,
        restrictionLiftAcknowledgedAt: true,
      },
      where: { id: userId },
    });

    if (!user || !isRestrictedUser(user)) {
      const reason = user ? getPendingRestrictionLift(user) : null;

      return {
        isRestricted: false,
        restrictionLift: reason ? { reason } : null,
      };
    }

    const appeal = await this.dataSource
      .getRepository(RestrictionAppealEntity)
      .findOne({
        select: { id: true, status: true },
        where: { userId, restrictedAt: user.restrictedAt! },
        order: { id: 'DESC' },
      });

    // 이의 신청할 수 있는 마지막 시각. 지나면 이의 신청 버튼을 숨긴다 (영구 정지는 제한 후 7일, 기간 정지는 끝날 때)
    const appealDeadline = getAppealDeadline(
      user.restrictedAt!,
      user.restrictedUntil,
    );

    return {
      isRestricted: true,
      reason: user.restrictedReason,
      restrictedAt: user.restrictedAt,
      restrictedUntil: user.restrictedUntil,
      appealStatus: appeal?.status ?? null,
      appealDeadline,
      // 다시 가입할 수 있게 되는 시각 (앱의 이의 신청 화면 제한 기간 끝).
      // 영구 정지는 이의 신청 기간이 끝나면 크론이 탈퇴시키고 그때부터 1년이라 예정 시각을 계산해서 준다.
      // 실제 banned_account.expires_at 은 탈퇴 시각으로 정해지므로 크론 시각 · 검토 중인 이의 신청만큼 늦어질 수 있다.
      // 기간 정지는 정지가 끝나는 시각 (banRejoinIfRestricted 와 같다)
      rejoinAvailableAt:
        user.restrictedUntil ??
        addMonths(appealDeadline, PERMANENT_REJOIN_BAN_MONTHS),
    };
  }

  /*
   * 앱의 이용 제한 해제 안내 화면에 보여줄 아직 확인하지 않은 해제 안내. 없으면 null.
   * 풀린 뒤 앱에 처음 들어올 때 한 번 보여준다 (제한 중이면 가드가 403 ACCOUNT_RESTRICTED 로 먼저 막는다)
   */
  async getRestrictionLift(
    userId: number,
  ): Promise<{ reason: RestrictionLiftReason } | null> {
    const user = await this.dataSource.getRepository(UserEntity).findOne({
      select: {
        id: true,
        restrictedAt: true,
        restrictedUntil: true,
        restrictionLiftReason: true,
        restrictionLiftAcknowledgedAt: true,
      },
      where: { id: userId },
    });

    const reason = user ? getPendingRestrictionLift(user) : null;

    return reason ? { reason } : null;
  }

  // 해제 안내 화면에서 확인을 눌렀다. 지금까지 풀린 제한의 안내를 모두 확인한 것으로 남긴다
  async acknowledgeRestrictionLift(userId: number, now = new Date()) {
    await this.dataSource
      .getRepository(UserEntity)
      .update(
        { id: userId },
        { restrictionLiftReason: null, restrictionLiftAcknowledgedAt: now },
      );
  }

  /*
   * 앱의 경고 안내 화면에 보여줄 아직 확인하지 않은 경고. 없으면 null.
   * 유효한 경고가 1회일 때만 준다 (2회 이상이면 이용 정지라 제재 화면이 대신 알린다)
   */
  async getUnacknowledgedWarning(
    userId: number,
    now = new Date(),
  ): Promise<{ reason: ReportReason; warnedAt: Date } | null> {
    const warnings = await this.dataSource
      .getRepository(UserSanctionEntity)
      .find({
        select: {
          id: true,
          reason: true,
          acknowledgedAt: true,
          createdAt: true,
        },
        where: {
          userId,
          type: SanctionType.WARNING,
          revokedAt: IsNull(),
          expiresAt: MoreThan(now),
        },
        take: SUSPENSION_WARNING_COUNT,
      });

    const [warning] = warnings;

    if (warnings.length !== 1 || warning.acknowledgedAt) {
      return null;
    }

    return { reason: warning.reason, warnedAt: warning.createdAt };
  }

  // 확인하지 않은 경고를 모두 확인한 것으로 남긴다
  async acknowledgeWarnings(userId: number, now = new Date()) {
    await this.dataSource.getRepository(UserSanctionEntity).update(
      {
        userId,
        type: SanctionType.WARNING,
        acknowledgedAt: IsNull(),
      },
      { acknowledgedAt: now },
    );
  }

  /*
   * 운영정책 안내 · 이용 정지 해제 안내 화면에 보여줄 제재 상세. 알림의 sanctionId 로 부른다.
   * 본인 제재가 아니거나 보관 기간이 지나 지워졌으면 404.
   *
   * warnings: 이 제재를 내린 시점에 유효했던 경고(이 제재 포함), 오래된 순. 경고 내역 1회차 · 2회차에 쓴다.
   *   그 뒤에 소멸 · 되돌림된 경고도 그 시점 기준으로 보여준다 (알림의 warningCount 와 같은 기준)
   * 되돌린 제재(revokedAt)도 이미 보낸 알림은 남아 있어서 그대로 돌려준다
   */
  async getSanctionDetail(userId: number, sanctionId: number) {
    const repository = this.dataSource.getRepository(UserSanctionEntity);
    const sanction = await repository.findOne({
      select: {
        id: true,
        type: true,
        targetType: true,
        reason: true,
        contentPreview: true,
        targetUserId: true,
        restriction: true,
        restrictedAt: true,
        restrictedUntil: true,
        createdAt: true,
      },
      where: { id: sanctionId, userId },
    });

    if (!sanction) {
      throw new NotFoundException('제재 내역을 찾을 수 없어요.');
    }

    // 대상 카드는 처리된 내 글(또는 계정)이라 내 프로필을 보여준다
    const user = await this.dataSource.getRepository(UserEntity).findOne({
      select: {
        id: true,
        profileImageKey: true,
        defaultProfileImageNo: true,
      },
      where: { id: userId },
    });

    // 대상 카드의 아이디는 상대 회원 것 ('@id님의 피드에 남긴 댓글' · '@id님에게 보낸 편지')
    const targetUser = sanction.targetUserId
      ? await this.dataSource.getRepository(UserEntity).findOne({
          select: { id: true, userCode: true, withdrawnAt: true },
          where: { id: Number(sanction.targetUserId) },
        })
      : null;

    const sanctionedAt = sanction.createdAt;
    const warnings = await repository.find({
      select: { id: true, targetType: true, createdAt: true },
      where: {
        userId,
        type: SanctionType.WARNING,
        id: LessThanOrEqual(Number(sanction.id)),
        expiresAt: MoreThan(sanctionedAt),
        revokedAt: Or(IsNull(), MoreThan(sanctionedAt)),
      },
      order: { id: 'ASC' },
    });

    return {
      sanctionId: Number(sanction.id),
      // WARNING: 경고 (누적되면 7일 · 영구 정지), BAN: 운영자가 바로 내린 영구 정지
      type: sanction.type,
      // 위반 사유 (ReportReason)
      reason: sanction.reason,
      // 신고 대상 종류. 조치 내용(댓글 삭제 / 피드 가림 / 편지 삭제 / 계정 제한)을 고른다
      targetType: sanction.targetType,
      // 대상 카드: 상대 회원 아이디, 내 프로필, 신고 당시 내용 미리보기 (회원 신고는 미리보기 null)
      // userCode: 댓글은 댓글을 단 피드의 작성자, 편지는 받은 사람.
      //   피드 · 회원 신고('내가 올린 피드' · '내 계정')이거나 상대가 탈퇴했으면 null
      userCode:
        targetUser && !isWithdrawnUser(targetUser) ? targetUser.userCode : null,
      profileImageUrl: user ? this.r2Service.getProfileImageUrl(user) : null,
      preview: sanction.contentPreview,
      // 조치 일자
      sanctionedAt,
      // 이 제재로 내려진 이용 제한 (SUSPENSION / PERMANENT). 경고 1회처럼 제한이 바뀌지 않았으면 null
      restriction: sanction.restriction,
      // 정지 기간. restriction 이 null 이면 둘 다 null, 영구 정지면 restrictedUntil 이 null
      restrictedAt: sanction.restrictedAt,
      restrictedUntil: sanction.restrictedUntil,
      warnings: warnings.map((warning) => ({
        warnedAt: warning.createdAt,
        targetType: warning.targetType,
      })),
    };
  }

  /*
   * 회원의 지금 이용 제한(restrictedAt)을 내린 제재. 이용 정지 해제 안내 알림에 붙인다.
   * 예전 방식(RESTRICT)으로 내린 제한은 제재 기록이 없어서 null
   */
  async findRestrictionSanctionId(userId: number, restrictedAt: Date) {
    const sanction = await this.dataSource
      .getRepository(UserSanctionEntity)
      .findOne({
        select: { id: true },
        where: {
          userId,
          restrictedAt,
          restriction: Not(IsNull()),
          revokedAt: IsNull(),
        },
        order: { id: 'DESC' },
      });

    return sanction ? Number(sanction.id) : null;
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

  /*
   * 운영정책 안내 화면의 대상 카드에 아이디를 보여줄 상대 회원 (user_sanction.target_user_id).
   * 댓글: 댓글을 단 피드의 작성자. 피드가 지워졌어도 정리 크론이 완전히 지우기 전이면 찾는다
   * 편지: 받은 사람. 받은 편지만 신고할 수 있어서 신고한 사람이 받은 사람이다
   * 피드 · 회원 신고는 null
   */
  private async findTargetUserId(
    manager: EntityManager,
    report: ReportEntity,
  ): Promise<number | null> {
    switch (report.targetType) {
      case ReportTargetType.LETTER:
        return Number(report.reporterId);

      case ReportTargetType.COMMENT: {
        const feedId = Number(report.contentSnapshot?.feedId);

        if (!Number.isSafeInteger(feedId)) {
          return null;
        }

        const feed = await manager.findOne(FeedEntity, {
          select: { id: true, recordId: true },
          where: { id: feedId },
          withDeleted: true,
        });

        if (!feed) {
          return null;
        }

        const record = await manager.findOne(RecordEntity, {
          select: { id: true, userId: true },
          where: { id: Number(feed.recordId) },
        });

        return record ? Number(record.userId) : null;
      }

      default:
        return null;
    }
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

    // 새 제한을 내리면 이전에 풀린 제한의 안내는 더 보여주지 않는다
    const next = {
      restrictedAt: now,
      restrictedUntil,
      restrictedReason: report.reason,
      restrictionLiftReason: null,
    };

    await manager.update(UserEntity, { id: user.id }, next);
    Object.assign(user, next);

    return applied;
  }
}
