import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LetterEntity } from '../letter/entities/letter.entity';
import { LetterService } from '../letter/letter.service';
import { StampEntity } from './entities/stamp.entity';

@Injectable()
export class StampService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly letterService: LetterService,
  ) {}

  // 편지함 우표 탭. 활성 우표 전체를 sort_order 순으로 내려주고, 각 우표가 붙은
  // 편지를 몇 번 받았는지(count)를 함께 준다. count가 0이면 아직 받아본 적 없는 우표.
  // 받은 편지 = 나에게 도착한 편지(나에게 쓴 편지 포함). 내가 삭제한 편지는 세지 않는다.
  async getStampCollection(params: { userId: number }) {
    const { userId } = params;

    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('userId가 올바르지 않습니다.');
    }

    // (receiver_id, stamp) 인덱스로 집계된다
    const rows = await this.dataSource
      .getRepository(StampEntity)
      .createQueryBuilder('stamp')
      .leftJoin(
        LetterEntity,
        'letter',
        [
          'letter.stamp = stamp.code',
          'letter.receiverId = :userId',
          'letter.receiverDeletedAt IS NULL',
          '(letter.deliveryAt IS NULL OR letter.deliveryAt <= :now)',
        ].join(' AND '),
        { userId, now: new Date() },
      )
      .select('stamp.code', 'code')
      .addSelect('COUNT(letter.id)', 'count')
      .where('stamp.isActive = true')
      .groupBy('stamp.code')
      .addGroupBy('stamp.sortOrder')
      .orderBy('stamp.sortOrder', 'ASC')
      .getRawMany<{ code: string; count: string | number }>();

    return {
      items: rows.map((row) => ({
        code: row.code,
        count: Number(row.count),
      })),
    };
  }

  // 우표 상세. 수집 횟수, 최초 수집일, 이 우표를 보내준 사람들, 수집한 편지 목록.
  // 수집 기준은 getStampCollection과 같다.
  async getStampDetail(params: { userId: number; code: string }) {
    const { userId, code } = params;

    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('userId가 올바르지 않습니다.');
    }

    const stamp = await this.dataSource
      .getRepository(StampEntity)
      .findOne({ where: { code, isActive: true } });

    if (!stamp) {
      throw new NotFoundException('우표를 찾을 수 없습니다.');
    }

    // 도착 시각이 최근인 순
    const letters = await this.letterService.getCollectedLettersByStamp({
      userId,
      stamp: code,
    });

    // 보내준 사람은 한 번씩만, 처음 보내준 편지가 오래된 순(왼쪽이 오래된 것)
    const senders = new Map<
      number,
      NonNullable<(typeof letters)[number]['sender']> & { isMe: boolean }
    >();

    for (const letter of [...letters].reverse()) {
      if (!letter.sender || senders.has(letter.sender.userId)) continue;

      senders.set(letter.sender.userId, {
        ...letter.sender,
        isMe: letter.sender.userId === userId,
      });
    }

    return {
      code,
      count: letters.length,
      firstCollectedAt: letters[letters.length - 1]?.arrivedAt ?? null,
      senders: [...senders.values()],
      letters,
    };
  }
}
