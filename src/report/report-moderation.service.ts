import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { ReportEntity } from './entities/report.entity';
import {
  ReportAction,
  ReportStatus,
  ReportTargetType,
  RestrictionPeriod,
} from './enums/report.enum';
import { FeedEntity } from '../feed/entities/feed.entity';
import { FeedCommentEntity } from '../feed-comment/entities/feed-comment.entity';
import { LetterEntity } from '../letter/entities/letter.entity';
import { UserEntity } from '../user/entities/user.entity';
import { isRestrictedUser, isWithdrawnUser } from '../user/withdrawn-user';
import { NotificationService } from '../notification/notification.service';
import { NotificationStatus } from '../notification/enums/notification.enum';
import { ReportDiscordService } from './discord/report-discord.service';

const DAY_MS = 24 * 60 * 60 * 1000;

// 가릴 수 있는 대상. 회원은 가리지 않고 이용을 제한한다
const BLINDABLE_ENTITIES = {
  [ReportTargetType.FEED]: FeedEntity,
  [ReportTargetType.COMMENT]: FeedCommentEntity,
  [ReportTargetType.LETTER]: LetterEntity,
} as const;

type BlindableTargetType = keyof typeof BLINDABLE_ENTITIES;

export type ReportHandleResult = {
  targetType: ReportTargetType;
  targetId: number;
  // 이번 처리로 대상의 상태(가림 · 이용 제한)가 바뀌었는지
  isTargetChanged: boolean;
  // 이번에 처리(또는 되돌린) 신고 수
  reportCount: number;
  // 이용 제한이 끝나는 시각. 영구 제한이면 null
  restrictedUntil?: Date | null;
};

// 대상의 지금 상태. 피드 · 댓글은 삭제 30일 뒤 완전히 지워져서 없을 수 있다
type TargetState = { exists: boolean; isSanctioned: boolean };

/*
 * 신고 처리. 신고 번호 하나를 받아 그 신고의 대상(피드 · 댓글 · 편지 · 회원)을 처리하고,
 * 같은 대상에 들어온 처리 전 신고를 모두 함께 처리한다.
 * 처리가 끝나면 신고한 사람들과 신고당한 사람에게 알림을 보낸다. (알림 설정으로 끌 수 없다)
 *
 * 대상 행을 잠그고 처리해서, 같은 대상을 동시에 처리해도 알림이 두 번 가지 않는다.
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
  ) {}

  // 피드 · 댓글 · 편지를 가린다. 이미 가려진 대상이면 남은 신고만 처리하고 작성자에게 다시 알리지 않는다
  async blind(
    reportId: number,
    handledBy: string | null = null,
  ): Promise<ReportHandleResult> {
    const { report, target, pendingReports } =
      await this.dataSource.transaction(async (manager) => {
        const report = await this.findReport(manager, reportId);

        if (!this.isBlindable(report.targetType)) {
          throw new BadRequestException(
            '회원 신고는 가릴 수 없어요. restrict 로 이용을 제한해 주세요.',
          );
        }

        const target = await this.lockTarget(manager, report);
        const now = new Date();

        if (target.exists && !target.isSanctioned) {
          await manager.update(
            BLINDABLE_ENTITIES[report.targetType],
            { id: report.targetId },
            { blindedAt: now },
          );
        }

        const pendingReports = await this.resolvePendingReports(
          manager,
          report,
          ReportAction.BLIND,
          now,
          handledBy,
        );

        return { report, target, pendingReports };
      });

    const isTargetChanged = target.exists && !target.isSanctioned;

    await this.syncDiscordMessages(report);

    await this.notifyReporters(
      pendingReports,
      NotificationStatus.REPORT_RESOLVED,
    );

    if (isTargetChanged) {
      await this.notifyReportedUser(report);
    }

    return {
      targetType: report.targetType,
      targetId: Number(report.targetId),
      isTargetChanged,
      reportCount: pendingReports.length,
    };
  }

  /*
   * 회원 이용을 제한한다. 회원 신고에만 쓸 수 있다.
   * 이미 제한 중이면 기간 · 사유를 이번 신고 기준으로 바꾸고, 회원에게 다시 알리지 않는다.
   */
  async restrict(
    reportId: number,
    period: RestrictionPeriod,
    handledBy: string | null = null,
  ): Promise<ReportHandleResult> {
    const result = await this.dataSource.transaction(async (manager) => {
      const report = await this.findReport(manager, reportId);

      if (report.targetType !== ReportTargetType.USER) {
        throw new BadRequestException(
          '이용 제한은 회원 신고에만 쓸 수 있어요. 글 신고는 blind 로 가려 주세요.',
        );
      }

      const user = await manager.findOne(UserEntity, {
        select: {
          id: true,
          withdrawnAt: true,
          restrictedAt: true,
          restrictedUntil: true,
        },
        where: { id: report.targetId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!user) {
        throw new NotFoundException('신고당한 회원을 찾을 수 없어요.');
      }

      const now = new Date();
      const wasRestricted = isRestrictedUser(user, now);
      const restrictedUntil =
        period === 'permanent'
          ? null
          : new Date(now.getTime() + period * DAY_MS);

      await manager.update(
        UserEntity,
        { id: user.id },
        {
          // 제한 중에 기간만 바꾸면 처음 제한한 시각은 그대로 둔다
          restrictedAt: wasRestricted ? user.restrictedAt : now,
          restrictedUntil,
          restrictedReason: report.reason,
        },
      );

      const pendingReports = await this.resolvePendingReports(
        manager,
        report,
        ReportAction.RESTRICT,
        now,
        handledBy,
      );

      return {
        report,
        pendingReports,
        restrictedUntil,
        isTargetChanged: !wasRestricted,
      };
    });

    await this.syncDiscordMessages(result.report);

    await this.notifyReporters(
      result.pendingReports,
      NotificationStatus.REPORT_RESOLVED,
    );

    if (result.isTargetChanged) {
      await this.notifyReportedUser(result.report);
    }

    return {
      targetType: result.report.targetType,
      targetId: Number(result.report.targetId),
      isTargetChanged: result.isTargetChanged,
      reportCount: result.pendingReports.length,
      restrictedUntil: result.restrictedUntil,
    };
  }

  /*
   * 운영정책 위반이 없다고 보고 처리 전 신고를 기각한다. 신고한 사람에게만 알린다.
   * 이미 가려졌거나 제한 중인 대상은 기각하면 안내가 서로 맞지 않아서 막는다.
   */
  async reject(
    reportId: number,
    handledBy: string | null = null,
  ): Promise<ReportHandleResult> {
    const { report, pendingReports } = await this.dataSource.transaction(
      async (manager) => {
        const report = await this.findReport(manager, reportId);
        const target = await this.lockTarget(manager, report);

        if (target.isSanctioned) {
          throw new BadRequestException(
            '이미 가려졌거나 이용 제한 중인 대상이에요. 남은 신고는 blind / restrict 로 처리해 주세요.',
          );
        }

        const pendingReports = await this.resolvePendingReports(
          manager,
          report,
          ReportAction.REJECT,
          new Date(),
          handledBy,
        );

        return { report, pendingReports };
      },
    );

    await this.syncDiscordMessages(report);

    await this.notifyReporters(
      pendingReports,
      NotificationStatus.REPORT_REJECTED,
    );

    return {
      targetType: report.targetType,
      targetId: Number(report.targetId),
      isTargetChanged: false,
      reportCount: pendingReports.length,
    };
  }

  /*
   * 잘못 처리했을 때 되돌린다. 가림 · 이용 제한을 풀고, 처리했던 신고를 다시 처리 전으로 돌린다.
   * 이미 보낸 알림은 지우지 않고, 되돌렸다는 알림도 보내지 않는다.
   */
  async undo(reportId: number): Promise<ReportHandleResult> {
    const result = await this.dataSource.transaction(async (manager) => {
      const report = await this.findReport(manager, reportId);
      const target = await this.lockTarget(manager, report);

      if (target.exists && target.isSanctioned) {
        if (report.targetType === ReportTargetType.USER) {
          await manager.update(
            UserEntity,
            { id: report.targetId },
            {
              restrictedAt: null,
              restrictedUntil: null,
              restrictedReason: null,
            },
          );
        } else if (this.isBlindable(report.targetType)) {
          await manager.update(
            BLINDABLE_ENTITIES[report.targetType],
            { id: report.targetId },
            { blindedAt: null },
          );
        }
      }

      const result = await manager.update(
        ReportEntity,
        {
          targetType: report.targetType,
          targetId: report.targetId,
          status: Not(ReportStatus.PENDING),
        },
        {
          status: ReportStatus.PENDING,
          action: null,
          handledAt: null,
          handledBy: null,
        },
      );

      return {
        targetType: report.targetType,
        targetId: Number(report.targetId),
        isTargetChanged: target.exists && target.isSanctioned,
        reportCount: result.affected ?? 0,
      };
    });

    await this.reportDiscordService.syncTargetMessages(
      result.targetType,
      result.targetId,
    );

    return result;
  }

  private async syncDiscordMessages(report: ReportEntity) {
    await this.reportDiscordService.syncTargetMessages(
      report.targetType,
      Number(report.targetId),
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

  // 대상 행을 잠그고 지금 상태를 본다. 지워진 글도 가릴 수 있게 삭제된 행까지 찾는다
  private async lockTarget(
    manager: EntityManager,
    report: ReportEntity,
  ): Promise<TargetState> {
    if (report.targetType === ReportTargetType.USER) {
      const user = await manager.findOne(UserEntity, {
        select: { id: true, restrictedAt: true, restrictedUntil: true },
        where: { id: report.targetId },
        lock: { mode: 'pessimistic_write' },
      });

      return { exists: !!user, isSanctioned: !!user && isRestrictedUser(user) };
    }

    if (!this.isBlindable(report.targetType)) {
      return { exists: false, isSanctioned: false };
    }

    const target = await manager.findOne<{
      id: number;
      blindedAt: Date | null;
    }>(BLINDABLE_ENTITIES[report.targetType], {
      select: { id: true, blindedAt: true },
      where: { id: report.targetId },
      withDeleted: true,
      lock: { mode: 'pessimistic_write' },
    });

    return { exists: !!target, isSanctioned: !!target?.blindedAt };
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

  // 신고한 사람마다 한 번씩. 같은 사람은 같은 대상을 한 번만 신고할 수 있다. 탈퇴한 회원에게는 보내지 않는다
  private async notifyReporters(
    reports: {
      reporterId: number;
      isReporterWithdrawn: boolean;
      targetType: ReportTargetType;
    }[],
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

  private async notifyReportedUser(report: ReportEntity) {
    if (isWithdrawnUser(report.reportedUser)) {
      return;
    }

    await this.notificationService.notify({
      userId: Number(report.reportedUserId),
      status: NotificationStatus.POLICY_NOTICE,
      targetType: report.targetType,
    });
  }
}
