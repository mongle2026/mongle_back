import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { LetterEntity } from './entities/letter.entity';
import {
  CreateNotificationInput,
  NotificationService,
} from '../notification/notification.service';
import { NotificationStatus } from '../notification/enums/notification.enum';

const DAY_MS = 24 * 60 * 60 * 1000;

const BATCH_SIZE = 100;
// 한 번 실행에서 처리할 최대 묶음 수. 남은 편지는 다음 실행(1분 뒤)에 이어서 처리한다.
const MAX_BATCHES_PER_RUN = 50;
// 알림 한 건이 DB 조회 몇 번 + Expo 요청이라, DB 풀(기본 5)을 넘지 않게 동시에 보낸다
const NOTIFY_CONCURRENCY = 5;

// 도착한 지 하루가 넘은 편지는 알림을 보내지 않고 표시만 한다.
// 알림 기능 배포 전에 도착한 편지들에 알림이 한꺼번에 나가는 것을 막는 안전장치.
const RECEIVED_STALE_MS = DAY_MS;

type TrackedColumn = 'receivedNotifiedAt' | 'arrivingSoonNotifiedAt';

/*
 * 예약 편지 알림.
 * 편지는 모두 도착일 자정에 도착해서, 정확히 자정에 한 번 도는 대신 매분 돌면서
 * "시각은 지났는데 아직 처리 안 한 편지"를 찾는다. 재배포나 재시작으로 자정을 놓쳐도 이어서 보낸다.
 *
 * 재배포 중에는 이전/새 컨테이너가 잠깐 같이 떠 있어서, 편지마다 조건부 UPDATE 로
 * 처리 표시를 먼저 가져간 쪽만 알림을 보낸다.
 */
@Injectable()
export class LetterNotificationScheduler {
  private readonly logger = new Logger(LetterNotificationScheduler.name);
  private isRunning = false;

  constructor(
    @InjectRepository(LetterEntity)
    private readonly letterRepository: Repository<LetterEntity>,

    private readonly notificationService: NotificationService,
  ) {}

  @Cron('0 * * * * *')
  async handleLetterNotifications() {
    // 처리가 1분을 넘기면 다음 실행은 건너뛴다
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      await this.notifyReceivedLetters();
      await this.notifyArrivingSoonLetters();
    } catch (error) {
      this.logger.error('편지 알림 크론 실패', error as Error);
    } finally {
      this.isRunning = false;
    }
  }

  // 받는 사람에게 "편지 도착"
  private async notifyReceivedLetters() {
    const now = new Date();

    await this.processDueLetters({
      column: 'receivedNotifiedAt',
      dueAt: now,
      now,
      toNotification: (letter) => {
        // 발송 취소된 편지, 너무 오래된 편지는 표시만 하고 보내지 않는다
        if (
          letter.receiverDeletedAt ||
          !letter.deliveryAt ||
          letter.deliveryAt.getTime() < now.getTime() - RECEIVED_STALE_MS
        ) {
          return null;
        }

        return {
          userId: Number(letter.receiverId),
          status: NotificationStatus.RECEIVE,
          actorId: Number(letter.senderId),
          letterId: Number(letter.id),
        };
      },
    });
  }

  // 보낸 사람에게 도착 24시간 전(전날 자정) "내일 도착 예정"
  private async notifyArrivingSoonLetters() {
    const now = new Date();

    await this.processDueLetters({
      column: 'arrivingSoonNotifiedAt',
      dueAt: new Date(now.getTime() + DAY_MS),
      now,
      toNotification: (letter) => {
        // 나에게 쓴 편지는 도착 알림만 받는다. 이미 도착했으면 늦은 예정 알림은 보내지 않는다.
        if (
          letter.senderDeletedAt ||
          Number(letter.senderId) === Number(letter.receiverId) ||
          !letter.deliveryAt ||
          letter.deliveryAt.getTime() <= now.getTime()
        ) {
          return null;
        }

        return {
          userId: Number(letter.senderId),
          status: NotificationStatus.SEND,
          actorId: Number(letter.receiverId),
          letterId: Number(letter.id),
        };
      },
    });
  }

  private async processDueLetters(params: {
    column: TrackedColumn;
    // delivery_at 이 이 시각 이하인 편지가 대상
    dueAt: Date;
    now: Date;
    // null 이면 알림 없이 처리 표시만 한다
    toNotification: (letter: LetterEntity) => CreateNotificationInput | null;
  }) {
    const { column, dueAt, now, toNotification } = params;

    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const letters = await this.letterRepository.find({
        select: {
          id: true,
          senderId: true,
          receiverId: true,
          deliveryAt: true,
          senderDeletedAt: true,
          receiverDeletedAt: true,
        },
        where: {
          [column]: IsNull(),
          deliveryAt: LessThanOrEqual(dueAt),
        },
        order: { id: 'ASC' },
        take: BATCH_SIZE,
      });

      if (letters.length === 0) {
        return;
      }

      const inputs: CreateNotificationInput[] = [];

      for (const letter of letters) {
        const claimed = await this.claim(letter.id, column, now);

        if (!claimed) {
          continue;
        }

        const input = toNotification(letter);

        if (input) {
          inputs.push(input);
        }
      }

      for (let i = 0; i < inputs.length; i += NOTIFY_CONCURRENCY) {
        await Promise.all(
          inputs
            .slice(i, i + NOTIFY_CONCURRENCY)
            .map((input) => this.notificationService.notify(input)),
        );
      }

      if (letters.length < BATCH_SIZE) {
        return;
      }
    }
  }

  // 아직 표시가 없을 때만 표시한다. 영향받은 행이 있으면 이 프로세스가 보낼 차례다.
  private async claim(letterId: number, column: TrackedColumn, now: Date) {
    const result = await this.letterRepository.update(
      { id: letterId, [column]: IsNull() },
      { [column]: now },
    );

    return (result.affected ?? 0) > 0;
  }
}
