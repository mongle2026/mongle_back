import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { ReportEntity } from './entities/report.entity';
import {
  ReportAction,
  ReportStatus,
  ReportTargetType,
} from './enums/report.enum';
import { FeedEntity } from '../feed/entities/feed.entity';
import { FeedCommentEntity } from '../feed-comment/entities/feed-comment.entity';
import { LetterEntity } from '../letter/entities/letter.entity';
import { UserEntity } from '../user/entities/user.entity';
import { isRestrictedUser, isWithdrawnUser } from '../user/withdrawn-user';
import { NotificationService } from '../notification/notification.service';
import { NotificationStatus } from '../notification/enums/notification.enum';
import { ReportDiscordService } from './discord/report-discord.service';
import { SanctionResult, SanctionService } from './sanction/sanction.service';
import { WithdrawalService } from '../auth/withdrawal.service';

// 가릴 수 있는 대상. 회원은 가리지 않고 경고 · 영구 정지만 한다
const BLINDABLE_ENTITIES = {
  [ReportTargetType.FEED]: FeedEntity,
  [ReportTargetType.COMMENT]: FeedCommentEntity,
  [ReportTargetType.LETTER]: LetterEntity,
} as const;

type BlindableTargetType = keyof typeof BLINDABLE_ENTITIES;

export type ReportHandleResult = {
  targetType: ReportTargetType;
  targetId: number;
  // 이번 처리로 대상의 상태(가림 · 경고 · 이용 제한)가 바뀌었는지
  isTargetChanged: boolean;
  // 이번에 처리(또는 되돌린) 신고 수
  reportCount: number;
  // 이번 처리로 신고당한 회원에게 내린 제재. 없으면 null
  sanction: SanctionResult | null;
};

type HandledReports = {
  report: ReportEntity;
  isTargetChanged: boolean;
  sanction: SanctionResult | null;
  pendingReports: {
    reporterId: number;
    isReporterWithdrawn: boolean;
    targetType: ReportTargetType;
  }[];
};

/*
 * 신고 처리. 신고 번호 하나를 받아 그 신고의 대상(피드 · 댓글 · 편지 · 회원)을 처리하고,
 * 같은 대상에 들어온 처리 전 신고를 모두 함께 처리한다.
 * 처리가 끝나면 신고한 사람들과 신고당한 사람에게 알림을 보낸다. (알림 설정으로 끌 수 없다)
 *
 * 제재 규칙 (sanction/sanction.constants.ts)
 * - 글을 가리면(blind) 작성자에게 경고 1회. 회원 신고는 가릴 글이 없어서 경고(warn)만 준다
 * - 유효한 경고(6개월 안)가 2회면 7일 이용 정지, 3회면 영구 정지
 * - 영구 정지(ban)는 경고 횟수와 관계없이 바로 내릴 수 있다. 영구 정지된 회원은 탈퇴시킬 수 있다(withdraw)
 *
 * 대상 행 → 회원 행 순서로 잠그고 처리해서, 같은 대상을 동시에 처리해도 경고 · 알림이 두 번 가지 않는다.
 * 디스코드 신고 메시지 버튼과 터미널 스크립트(npm run report:handle)에서 부른다.
 * 처리한 뒤에는 같은 대상의 디스코드 신고 메시지를 모두 지금 상태로 고친다.
 *
 * handledBy: 처리한 운영자의 디스코드 사용자 id. 터미널로 처리하면 null
 */
@Injectable()
export class ReportModerationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
    private readonly reportDiscordService: ReportDiscordService,
    private readonly sanctionService: SanctionService,
    private readonly withdrawalService: WithdrawalService,
  ) {}

  /*
   * 피드 · 댓글 · 편지를 가리고 작성자에게 경고 1회를 준다.
   * 이미 가려졌거나 완전히 지워진 대상이면 남은 신고만 처리하고, 경고 · 알림은 다시 주지 않는다.
   * 작성자가 탈퇴했으면 가리기만 한다.
   */
  async blind(
    reportId: number,
    handledBy: string | null = null,
  ): Promise<ReportHandleResult> {
    const handled = await this.dataSource.transaction(async (manager) => {
      const report = await this.findReport(manager, reportId);

      if (!this.isBlindable(report.targetType)) {
        throw new BadRequestException(
          '회원 신고는 가릴 수 없어요. 경고(warn) 또는 영구 정지(ban)로 처리해 주세요.',
        );
      }

      const now = new Date();
      const isTargetChanged = await this.blindTarget(
        manager,
        report.targetType,
        report.targetId,
        now,
      );
      let sanction: SanctionResult | null = null;

      if (isTargetChanged) {
        const author = await this.sanctionService.lockUser(
          manager,
          report.reportedUserId,
        );

        if (author && !isWithdrawnUser(author)) {
          sanction = await this.sanctionService.issueWarning(
            manager,
            author,
            report,
            handledBy,
            now,
          );
        }
      }

      const pendingReports = await this.resolvePendingReports(
        manager,
        report,
        ReportAction.BLIND,
        now,
        handledBy,
      );

      return { report, isTargetChanged, sanction, pendingReports };
    });

    return await this.finish(handled, NotificationStatus.REPORT_RESOLVED);
  }

  // 회원 신고: 신고당한 회원에게 경고 1회를 준다. 처리할 때마다 새 경고가 쌓인다
  async warn(
    reportId: number,
    handledBy: string | null = null,
  ): Promise<ReportHandleResult> {
    const handled = await this.dataSource.transaction(async (manager) => {
      const report = await this.findReport(manager, reportId);

      if (report.targetType !== ReportTargetType.USER) {
        throw new BadRequestException(
          '경고만 주는 처리는 회원 신고에만 쓸 수 있어요. 글 신고는 가리기(blind)로 처리해 주세요.',
        );
      }

      const now = new Date();
      const user = await this.lockActiveReportedUser(manager, report);
      const sanction = await this.sanctionService.issueWarning(
        manager,
        user,
        report,
        handledBy,
        now,
      );

      const pendingReports = await this.resolvePendingReports(
        manager,
        report,
        ReportAction.WARN,
        now,
        handledBy,
      );

      return { report, isTargetChanged: true, sanction, pendingReports };
    });

    return await this.finish(handled, NotificationStatus.REPORT_RESOLVED);
  }

  /*
   * 경고 횟수와 관계없이 바로 영구 정지한다. 글 신고면 글도 가린다. (경고는 주지 않는다)
   * 이미 영구 정지 중이면 기록만 남기고 회원에게 다시 알리지 않는다.
   */
  async ban(
    reportId: number,
    handledBy: string | null = null,
  ): Promise<ReportHandleResult> {
    const handled = await this.dataSource.transaction(async (manager) => {
      const report = await this.findReport(manager, reportId);
      const now = new Date();
      const isBlinded = this.isBlindable(report.targetType)
        ? await this.blindTarget(
            manager,
            report.targetType,
            report.targetId,
            now,
          )
        : false;

      const user = await this.lockActiveReportedUser(manager, report);
      const sanction = await this.sanctionService.ban(
        manager,
        user,
        report,
        handledBy,
        now,
      );

      const pendingReports = await this.resolvePendingReports(
        manager,
        report,
        ReportAction.BAN,
        now,
        handledBy,
      );

      return {
        report,
        isTargetChanged: isBlinded || !!sanction.restriction,
        sanction: sanction.restriction ? sanction : null,
        pendingReports,
      };
    });

    return await this.finish(handled, NotificationStatus.REPORT_RESOLVED);
  }

  /*
   * 운영정책 위반이 없다고 보고 처리 전 신고를 기각한다. 신고한 사람에게만 알린다.
   * 이미 가려진 글은 기각하면 안내가 서로 맞지 않아서 막는다.
   * 회원 신고는 처리할 때마다 따로 판단하므로 이전에 경고했어도 기각할 수 있다.
   */
  async reject(
    reportId: number,
    handledBy: string | null = null,
  ): Promise<ReportHandleResult> {
    const handled = await this.dataSource.transaction(async (manager) => {
      const report = await this.findReport(manager, reportId);

      if (this.isBlindable(report.targetType)) {
        const target = await this.lockBlindableTarget(
          manager,
          report.targetType,
          report.targetId,
        );

        if (target?.blindedAt) {
          throw new BadRequestException(
            '이미 가려진 대상이에요. 남은 신고는 가리기(blind) 또는 영구 정지(ban)로 처리해 주세요.',
          );
        }
      }

      const pendingReports = await this.resolvePendingReports(
        manager,
        report,
        ReportAction.REJECT,
        new Date(),
        handledBy,
      );

      return { report, isTargetChanged: false, sanction: null, pendingReports };
    });

    return await this.finish(handled, NotificationStatus.REPORT_REJECTED);
  }

  /*
   * 잘못 처리했을 때 되돌린다. 가림을 풀고, 이 대상으로 준 경고 · 영구 정지를 없애고(이용 제한도 이전으로),
   * 처리했던 신고를 다시 처리 전으로 돌린다. (신고한 사람마다 하나씩. findReportsToReopen 참고)
   * 이미 보낸 알림은 지우지 않고, 되돌렸다는 알림도 보내지 않는다. 탈퇴시킨 회원은 되돌릴 수 없다.
   */
  async undo(reportId: number): Promise<ReportHandleResult> {
    const result = await this.dataSource.transaction(async (manager) => {
      const report = await this.findReport(manager, reportId);
      const now = new Date();
      let isTargetChanged = false;

      if (this.isBlindable(report.targetType)) {
        const target = await this.lockBlindableTarget(
          manager,
          report.targetType,
          report.targetId,
        );

        if (target?.blindedAt) {
          await manager.update(
            BLINDABLE_ENTITIES[report.targetType],
            { id: report.targetId },
            { blindedAt: null },
          );
          isTargetChanged = true;
        }
      }

      const revokedCount = await this.sanctionService.revokeForTarget(
        manager,
        report.targetType,
        Number(report.targetId),
        now,
      );

      if (revokedCount > 0) {
        isTargetChanged = true;
      }

      // 예전 방식(기간을 골라 이용 제한)으로 처리한 회원 신고는 예전처럼 제한을 푼다
      if (
        report.targetType === ReportTargetType.USER &&
        (await this.liftLegacyRestriction(manager, report))
      ) {
        isTargetChanged = true;
      }

      const reopenIds = await this.findReportsToReopen(manager, report);

      if (reopenIds.length > 0) {
        await manager.update(
          ReportEntity,
          { id: In(reopenIds) },
          {
            status: ReportStatus.PENDING,
            pendingKey: 1,
            action: null,
            handledAt: null,
            handledBy: null,
          },
        );
      }

      return {
        report,
        handleResult: {
          targetType: report.targetType,
          targetId: Number(report.targetId),
          isTargetChanged,
          reportCount: reopenIds.length,
          sanction: null,
        },
      };
    });

    await this.syncDiscordMessages(result.report);

    return result.handleResult;
  }

  /*
   * 영구 정지된 신고당한 회원을 탈퇴시킨다. 같은 소셜 계정으로 다시 가입할 수 없다 (banned_account).
   * 되돌릴 수 없다. 회원에게 알림을 보내지 않는다 (탈퇴하면 알림 · 푸시 토큰이 지워진다).
   */
  async withdraw(reportId: number, handledBy: string | null = null) {
    const report = await this.findReport(this.dataSource.manager, reportId);
    const userId = Number(report.reportedUserId);

    await this.withdrawalService.forceWithdraw(userId, handledBy);
    await this.syncDiscordMessages(report);

    return { targetType: report.targetType, targetId: report.targetId, userId };
  }

  // 처리가 커밋된 뒤: 디스코드 메시지를 고치고, 신고한 사람 · 신고당한 사람에게 알린다
  private async finish(
    { report, isTargetChanged, sanction, pendingReports }: HandledReports,
    reporterStatus:
      | NotificationStatus.REPORT_RESOLVED
      | NotificationStatus.REPORT_REJECTED,
  ): Promise<ReportHandleResult> {
    await this.syncDiscordMessages(report);
    await this.notifyReporters(pendingReports, reporterStatus);

    if (sanction) {
      await this.notifyReportedUser(report, sanction);
    }

    return {
      targetType: report.targetType,
      targetId: Number(report.targetId),
      isTargetChanged,
      reportCount: pendingReports.length,
      sanction,
    };
  }

  private async syncDiscordMessages(report: ReportEntity) {
    await this.reportDiscordService.syncMessages(
      report.targetType,
      Number(report.targetId),
      Number(report.reportedUserId),
    );
  }

  private isBlindable(
    targetType: ReportTargetType,
  ): targetType is BlindableTargetType {
    return targetType in BLINDABLE_ENTITIES;
  }

  private async findReport(manager: EntityManager, reportId: number) {
    const report = await manager.findOne(ReportEntity, {
      where: { id: reportId },
      relations: { reportedUser: true },
    });

    if (!report) {
      throw new NotFoundException(`신고 #${reportId} 를 찾을 수 없어요.`);
    }

    return report;
  }

  // 글 행을 잠그고 지금 상태를 본다. 지워진 글도 가릴 수 있게 삭제된 행까지 찾는다. 완전히 지워졌으면 null
  private async lockBlindableTarget(
    manager: EntityManager,
    targetType: BlindableTargetType,
    targetId: number,
  ) {
    return await manager.findOne<{ id: number; blindedAt: Date | null }>(
      BLINDABLE_ENTITIES[targetType],
      {
        select: { id: true, blindedAt: true },
        where: { id: targetId },
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      },
    );
  }

  // 글을 가린다. 이번에 가렸으면 true (이미 가려졌거나 완전히 지워졌으면 false)
  private async blindTarget(
    manager: EntityManager,
    targetType: BlindableTargetType,
    targetId: number,
    now: Date,
  ) {
    const target = await this.lockBlindableTarget(
      manager,
      targetType,
      targetId,
    );

    if (!target || target.blindedAt) {
      return false;
    }

    await manager.update(
      BLINDABLE_ENTITIES[targetType],
      { id: targetId },
      { blindedAt: now },
    );

    return true;
  }

  // 경고 · 영구 정지할 신고당한 회원을 잠근다. 탈퇴한 회원은 제재할 수 없다
  private async lockActiveReportedUser(
    manager: EntityManager,
    report: ReportEntity,
  ) {
    const user = await this.sanctionService.lockUser(
      manager,
      report.reportedUserId,
    );

    if (!user) {
      throw new NotFoundException('신고당한 회원을 찾을 수 없어요.');
    }

    if (isWithdrawnUser(user)) {
      throw new BadRequestException(
        '탈퇴한 회원이라 경고 · 영구 정지할 수 없어요. 글 신고는 가리기(blind)로 처리해 주세요.',
      );
    }

    return user;
  }

  // 예전 방식(RESTRICT)으로 처리한 신고가 있으면 회원의 이용 제한을 푼다. 풀었으면 true
  private async liftLegacyRestriction(
    manager: EntityManager,
    report: ReportEntity,
  ) {
    const hasLegacyRestrict = await manager.exists(ReportEntity, {
      where: {
        targetType: report.targetType,
        targetId: report.targetId,
        action: ReportAction.RESTRICT,
      },
    });

    if (!hasLegacyRestrict) {
      return false;
    }

    const user = await this.sanctionService.lockUser(
      manager,
      Number(report.targetId),
    );

    if (!user || !isRestrictedUser(user)) {
      return false;
    }

    await manager.update(
      UserEntity,
      { id: user.id },
      { restrictedAt: null, restrictedUntil: null, restrictedReason: null },
    );

    return true;
  }

  /*
   * 되돌릴 때 다시 처리 전으로 돌릴 신고. 같은 사람은 같은 대상에 처리 전 신고를 하나만 가질 수 있어서
   * (처리가 끝난 뒤 다시 신고할 수 있다) 사람마다 가장 최근에 처리된 신고 하나만 돌리고,
   * 이미 처리 전 신고가 있는 사람의 신고는 그대로 둔다.
   * 대상의 신고 행을 잠가서, 되돌리는 동안 같은 대상에 새 신고가 끼어들지 않게 한다.
   */
  private async findReportsToReopen(
    manager: EntityManager,
    report: ReportEntity,
  ) {
    const reports = await manager.find(ReportEntity, {
      select: { id: true, reporterId: true, status: true },
      where: { targetType: report.targetType, targetId: report.targetId },
      order: { id: 'DESC' },
      lock: { mode: 'pessimistic_write' },
    });

    const pendingReporterIds = new Set(
      reports
        .filter(({ status }) => status === ReportStatus.PENDING)
        .map(({ reporterId }) => Number(reporterId)),
    );
    const reopenIds: number[] = [];

    for (const { id, reporterId, status } of reports) {
      if (
        status === ReportStatus.PENDING ||
        pendingReporterIds.has(Number(reporterId))
      ) {
        continue;
      }

      pendingReporterIds.add(Number(reporterId));
      reopenIds.push(Number(id));
    }

    return reopenIds;
  }

  // 같은 대상의 처리 전 신고를 모두 처리한다. 알림을 보낼 신고한 사람을 알기 위해 처리한 신고를 돌려준다
  private async resolvePendingReports(
    manager: EntityManager,
    report: ReportEntity,
    action: ReportAction,
    now: Date,
    handledBy: string | null,
  ) {
    const pendingReports = await manager.find(ReportEntity, {
      select: {
        id: true,
        reporterId: true,
        reporter: { id: true, withdrawnAt: true },
      },
      relations: { reporter: true },
      where: {
        targetType: report.targetType,
        targetId: report.targetId,
        status: ReportStatus.PENDING,
      },
    });

    if (pendingReports.length > 0) {
      await manager.update(
        ReportEntity,
        { id: In(pendingReports.map(({ id }) => id)) },
        {
          status:
            action === ReportAction.REJECT
              ? ReportStatus.REJECTED
              : ReportStatus.RESOLVED,
          pendingKey: null,
          action,
          handledAt: now,
          handledBy,
        },
      );
    }

    return pendingReports.map((pendingReport) => ({
      reporterId: Number(pendingReport.reporterId),
      isReporterWithdrawn: isWithdrawnUser(pendingReport.reporter),
      targetType: report.targetType,
    }));
  }

  // 신고한 사람마다 한 번씩. 같은 사람은 같은 대상에 처리 전 신고를 하나만 가질 수 있다. 탈퇴한 회원에게는 보내지 않는다
  private async notifyReporters(
    reports: HandledReports['pendingReports'],
    status:
      | NotificationStatus.REPORT_RESOLVED
      | NotificationStatus.REPORT_REJECTED,
  ) {
    for (const { reporterId, isReporterWithdrawn, targetType } of reports) {
      if (isReporterWithdrawn) {
        continue;
      }

      await this.notificationService.notify({
        userId: Number(reporterId),
        status,
        targetType,
      });
    }
  }

  // 운영정책 안내: 어떤 글이 처리됐는지 + 경고 · 정지 내용
  private async notifyReportedUser(
    report: ReportEntity,
    sanction: SanctionResult,
  ) {
    if (isWithdrawnUser(report.reportedUser)) {
      return;
    }

    await this.notificationService.notify({
      userId: Number(report.reportedUserId),
      status: NotificationStatus.POLICY_NOTICE,
      targetType: report.targetType,
      sanction: sanction.notice,
      warningCount: sanction.warningCount,
    });
  }
}
