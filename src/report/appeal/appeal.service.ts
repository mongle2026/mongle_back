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
import {
  buildLiftedRestriction,
  isRestrictedUser,
} from '../../user/withdrawn-user';
import {
  getAppealDeadline,
  PERMANENT_APPEAL_DAYS,
  RestrictionLiftReason,
} from '../sanction/sanction.constants';
import { NotificationService } from '../../notification/notification.service';
import { NotificationStatus } from '../../notification/enums/notification.enum';

export type AppealHandleResult = {
  // 이번에 처리했으면 그 결과. 이미 처리된 신청이면 null
  status: AppealStatus | null;
};

type RestrictionFields = Pick<
  UserEntity,
  'withdrawnAt' | 'restrictedAt' | 'restrictedUntil' | 'restrictedReason'
>;

/*
 * 이용 제한 이의 신청.
 * - 회원: 제재 화면에서 낸다. 한 제한에 검토 중인 신청은 하나만 둔다. 기각되면 다시 낼 수 있다.
 * - 운영자: 디스코드 이의 신청 채널의 [제한 풀기] [기각] 버튼으로 처리한다. 결과는 알림 목록과 푸시로 알린다.
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

      // 영구 정지는 안내를 받은 날부터 PERMANENT_APPEAL_DAYS 일 안에만 낼 수 있다 (기간 정지는 정지 중이면 언제든)
      if (
        getAppealDeadline(user.restrictedAt!, user.restrictedUntil) <=
        new Date()
      ) {
        throw new BadRequestException(
          `영구 이용 정지는 안내를 받은 날부터 ${PERMANENT_APPEAL_DAYS}일 안에만 이의 신청할 수 있어요.`,
        );
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

  // 제한 풀기: 이용 제한을 풀고 회원에게 알린다
  async accept(appealId: number, handledBy: string) {
    return await this.handle(appealId, handledBy, AppealStatus.ACCEPTED);
  }

  // 기각: 제한은 그대로 두고 회원에게 알린다. 회원은 다시 이의 신청할 수 있다
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

      // 앱이 풀린 뒤 처음 들어올 때 '이의 신청이 받아들여졌어요' 안내를 띄운다
      if (status === AppealStatus.ACCEPTED) {
        await manager.update(
          UserEntity,
          { id: appeal.userId },
          buildLiftedRestriction(RestrictionLiftReason.APPEAL_ACCEPTED),
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

    // 알림 목록에 남기고 푸시도 보낸다. 운영 조치 안내라 알림 설정과 관계없이 보낸다 (ALWAYS_DELIVERED_STATUSES)
    if (
      result.status === AppealStatus.ACCEPTED ||
      result.status === AppealStatus.REJECTED
    ) {
      await this.notificationService.notify({
        userId: result.userId,
        status:
          result.status === AppealStatus.ACCEPTED
            ? NotificationStatus.APPEAL_ACCEPTED
            : NotificationStatus.APPEAL_REJECTED,
      });
    }

    return { status: result.status };
  }

  // 이의를 낸 제한이 아직 이어지고 있는지. 기간만 바뀐 건 같은 제한이다.
  // 검토 전에 탈퇴했으면 풀어 줄 계정이 없어서 이어지지 않는 것으로 본다 (재가입 제한은 그대로)
  private isSameRestriction(
    user: RestrictionFields | null,
    appeal: RestrictionAppealEntity,
  ) {
    return (
      !!user &&
      !user.withdrawnAt &&
      isRestrictedUser(user) &&
      new Date(user.restrictedAt!).getTime() ===
        new Date(appeal.restrictedAt).getTime()
    );
  }

  private async lockUser(manager: EntityManager, userId: number) {
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
}
