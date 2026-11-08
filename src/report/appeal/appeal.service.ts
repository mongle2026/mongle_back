import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  AppealStatus,
  RestrictionAppealEntity,
} from './entities/restriction-appeal.entity';
import { CreateAppealDto } from './dto/create-appeal.dto';
import { AppealDiscordService } from './appeal-discord.service';
import { ReportTargetType } from '../enums/report.enum';
import { ReportDiscordService } from '../discord/report-discord.service';
import { UserEntity } from '../../user/entities/user.entity';
import { isRestrictedUser } from '../../user/withdrawn-user';
import { NotificationService } from '../../notification/notification.service';
import {
  NotificationSettingKey,
  NotificationType,
} from '../../notification/enums/notification.enum';
import { buildAppealResultPushContent } from '../../notification/notification-message.util';

// 이의 신청 결과 푸시의 data.status. 알림 목록에는 없는 값이라 앱은 누르면 앱만 연다
export const APPEAL_PUSH_STATUS = {
  ACCEPTED: 'appeal_accepted',
  REJECTED: 'appeal_rejected',
} as const;

export type AppealHandleResult = {
  // 이번에 처리했으면 그 결과. 이미 처리된 신청이면 null
  status: AppealStatus | null;
};

type RestrictionFields = Pick<
  UserEntity,
  'restrictedAt' | 'restrictedUntil' | 'restrictedReason'
>;

/*
 * 이용 제한 이의 신청.
 * - 회원: 제재 화면에서 낸다. 한 제한에 검토 중인 신청은 하나만 둔다. 기각되면 다시 낼 수 있다.
 * - 운영자: 디스코드 이의 신청 채널의 [제한 풀기] [기각] 버튼으로 처리한다. 결과는 푸시로만 알린다.
 */
@Injectable()
export class AppealService {
  constructor(
    @InjectRepository(RestrictionAppealEntity)
    private readonly appealRepository: Repository<RestrictionAppealEntity>,

    private readonly dataSource: DataSource,
    private readonly appealDiscordService: AppealDiscordService,
    private readonly reportDiscordService: ReportDiscordService,
    private readonly notificationService: NotificationService,
  ) {}

  // 이미 검토 중인 신청이 있으면 다시 저장하지 않고 isAlreadyAppealed: true 로 응답한다
  async create(currentUserId: number, dto: CreateAppealDto) {
    const result = await this.dataSource.transaction(async (manager) => {
      // 같은 회원이 동시에 두 번 보내도 검토 중인 신청이 하나만 생기도록 회원 행을 잠근다
      const user = await this.lockUser(manager, currentUserId);

      if (!user || !isRestrictedUser(user)) {
        throw new BadRequestException('이용 제한 중인 계정이 아니에요.');
      }

      const pending = await manager.findOne(RestrictionAppealEntity, {
        select: { id: true },
        where: {
          userId: currentUserId,
          restrictedAt: user.restrictedAt!,
          status: AppealStatus.PENDING,
        },
      });

      if (pending) {
        return { appealId: null };
      }

      const appeal = await manager.save(
        manager.create(RestrictionAppealEntity, {
          userId: currentUserId,
          restrictedAt: user.restrictedAt!,
          restrictedUntil: user.restrictedUntil,
          restrictedReason: user.restrictedReason,
          content: dto.content,
        }),
      );

      return { appealId: Number(appeal.id) };
    });

    if (!result.appealId) {
      return { appealStatus: AppealStatus.PENDING, isAlreadyAppealed: true };
    }

    // 알림이 실패해도 이의 신청은 저장됐으니 기다리지 않는다
    void this.appealDiscordService.notifyAppeal(result.appealId);

    return { appealStatus: AppealStatus.PENDING, isAlreadyAppealed: false };
  }

  /*
   * 지금 이용 제한 상태. 제재 화면이 앱으로 돌아올 때 · 푸시를 받을 때 다시 확인하려고 부른다.
   * 제한 중이 아니면 { isRestricted: false } 만 준다.
   * appealStatus: 이 제한에 낸 마지막 이의 신청의 상태. 안 냈으면 null
   */
  async getRestriction(currentUserId: number) {
    const user = await this.dataSource.getRepository(UserEntity).findOne({
      select: {
        id: true,
        restrictedAt: true,
        restrictedUntil: true,
        restrictedReason: true,
      },
      where: { id: currentUserId },
    });

    if (!user || !isRestrictedUser(user)) {
      return { isRestricted: false };
    }

    const appeal = await this.appealRepository.findOne({
      select: { id: true, status: true },
      where: { userId: currentUserId, restrictedAt: user.restrictedAt! },
      order: { id: 'DESC' },
    });

    return {
      isRestricted: true,
      reason: user.restrictedReason,
      restrictedUntil: user.restrictedUntil,
      appealStatus: appeal?.status ?? null,
    };
  }

  // 제한 풀기: 이용 제한을 풀고 회원에게 푸시로 알린다
  async accept(appealId: number, handledBy: string) {
    return await this.handle(appealId, handledBy, AppealStatus.ACCEPTED);
  }

  // 기각: 제한은 그대로 두고 회원에게 푸시로 알린다. 회원은 다시 이의 신청할 수 있다
  async reject(appealId: number, handledBy: string) {
    return await this.handle(appealId, handledBy, AppealStatus.REJECTED);
  }

  /*
   * 검토 전에 제한이 먼저 풀렸거나(신고 되돌리기 · 기간 끝남) 새 제한으로 바뀌었으면,
   * 어떤 버튼을 눌러도 처리하지 않고 CLOSED 로 닫는다. 회원에게는 알리지 않는다.
   */
  private async handle(
    appealId: number,
    handledBy: string,
    nextStatus: AppealStatus.ACCEPTED | AppealStatus.REJECTED,
  ): Promise<AppealHandleResult> {
    const result = await this.dataSource.transaction(async (manager) => {
      const appeal = await manager.findOne(RestrictionAppealEntity, {
        where: { id: appealId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!appeal) {
        throw new NotFoundException(
          `이의 신청 #${appealId} 를 찾을 수 없어요.`,
        );
      }

      if (appeal.status !== AppealStatus.PENDING) {
        return { status: null, userId: Number(appeal.userId) };
      }

      const user = await this.lockUser(manager, appeal.userId);
      const status = this.isSameRestriction(user, appeal)
        ? nextStatus
        : AppealStatus.CLOSED;

      if (status === AppealStatus.ACCEPTED) {
        await manager.update(
          UserEntity,
          { id: appeal.userId },
          { restrictedAt: null, restrictedUntil: null, restrictedReason: null },
        );
      }

      await manager.update(
        RestrictionAppealEntity,
        { id: appeal.id },
        { status, handledAt: new Date(), handledBy },
      );

      return { status, userId: Number(appeal.userId) };
    });

    if (result.status) {
      await this.appealDiscordService.syncMessage(appealId);
    }

    if (result.status === AppealStatus.ACCEPTED) {
      // 신고 채널의 회원 신고 · 처리 전 신고 메시지의 제재 상태도 고친다
      await this.reportDiscordService.syncMessages(
        ReportTargetType.USER,
        result.userId,
        result.userId,
      );
    }

    if (
      result.status === AppealStatus.ACCEPTED ||
      result.status === AppealStatus.REJECTED
    ) {
      const isAccepted = result.status === AppealStatus.ACCEPTED;

      await this.notificationService.sendPushOnly(result.userId, {
        ...buildAppealResultPushContent(isAccepted),
        data: {
          type: NotificationType.NEWS,
          status: isAccepted
            ? APPEAL_PUSH_STATUS.ACCEPTED
            : APPEAL_PUSH_STATUS.REJECTED,
        },
        // 푸시 채널은 운영 조치 안내(policy_notice 등)와 같은 시스템 알림
        settingKey: NotificationSettingKey.SYSTEM,
      });
    }

    return { status: result.status };
  }

  // 이의를 낸 제한이 아직 이어지고 있는지. 기간만 바뀐 건 같은 제한이다
  private isSameRestriction(
    user: RestrictionFields | null,
    appeal: RestrictionAppealEntity,
  ) {
    return (
      !!user &&
      isRestrictedUser(user) &&
      new Date(user.restrictedAt!).getTime() ===
        new Date(appeal.restrictedAt).getTime()
    );
  }

  private async lockUser(manager: EntityManager, userId: number) {
    return await manager.findOne(UserEntity, {
      select: {
        id: true,
        restrictedAt: true,
        restrictedUntil: true,
        restrictedReason: true,
      },
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
  }
}
