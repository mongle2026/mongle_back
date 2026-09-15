import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LetterEntity } from '../letter/entities/letter.entity';
import { StampEntity } from './entities/stamp.entity';

@Injectable()
export class StampService {
  constructor(private readonly dataSource: DataSource) {}

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
}
