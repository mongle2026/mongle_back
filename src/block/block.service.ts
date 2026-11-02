import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserBlockEntity } from './entities/user-block.entity';
import { UserEntity } from '../user/entities/user.entity';
import { R2Service } from '../storage/r2.service';
import { UserService } from '../user/user.service';

const BLOCK_LIST_DEFAULT_LIMIT = 20;
const BLOCK_LIST_MAX_LIMIT = 50;

type BlockListQuery = { cursor?: number; limit?: number };

type BlockUserRow = Pick<
  UserEntity,
  | 'publicId'
  | 'userCode'
  | 'nickname'
  | 'profileImageKey'
  | 'defaultProfileImageNo'
> & {
  blockId: string;
  blockedAt: Date;
};

/*
 * 회원 차단. 한쪽이 차단하면 두 사람 모두에게 서로의 글 · 댓글 · 편지 · 알림이 보이지 않는다.
 * 차단하면 서로 걸린 팔로우를 모두 끊고, 차단된 동안은 다시 팔로우할 수 없다.
 * 각 목록에서 거르는 조건은 block.sql.ts 의 blockedBetweenSql 을 쓴다.
 */
@Injectable()
export class BlockService {
  constructor(
    @InjectRepository(UserBlockEntity)
    private readonly blockRepository: Repository<UserBlockEntity>,

    private readonly dataSource: DataSource,
    private readonly r2Service: R2Service,
    private readonly userService: UserService,
  ) {}

  async blockUser(currentUserId: number, targetPublicId: string) {
    // 없는(탈퇴한) 사용자면 404
    const targetUserId = await this.userService.getIdByPublicId(targetPublicId);

    if (targetUserId === currentUserId) {
      throw new BadRequestException('자기 자신은 차단할 수 없습니다.');
    }

    await this.dataSource.transaction(async (manager) => {
      // 이미 차단 중이면 유니크 키에 걸려 아무것도 바뀌지 않는다
      await manager.query(
        `INSERT INTO \`user_block\` (\`blocker_id\`, \`blocked_id\`)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE \`blocker_id\` = \`blocker_id\``,
        [currentUserId, targetUserId],
      );

      // 내가 그 사람을, 그 사람이 나를 팔로우하던 것 모두 끊는다
      await manager.query(
        `DELETE FROM \`follow\`
          WHERE (\`follower_id\` = ? AND \`following_id\` = ?)
            OR (\`follower_id\` = ? AND \`following_id\` = ?)`,
        [currentUserId, targetUserId, targetUserId, currentUserId],
      );
    });

    return {
      blockedId: targetPublicId,
      isBlocked: true,
    };
  }

  async unblockUser(currentUserId: number, targetPublicId: string) {
    // 없는 사용자거나 차단하지 않은 사용자면 지워지는 행이 없을 뿐이라 따로 확인하지 않는다.
    // 상대가 나를 차단한 것은 내가 풀 수 없다
    const result: { affectedRows: number } = await this.blockRepository.query(
      `DELETE \`user_block\` FROM \`user_block\`
        INNER JOIN \`user\` ON \`user\`.\`id\` = \`user_block\`.\`blocked_id\`
        WHERE \`user_block\`.\`blocker_id\` = ? AND \`user\`.\`public_id\` = ?`,
      [currentUserId, targetPublicId],
    );

    return {
      blockedId: targetPublicId,
      isBlocked: false,
      deleted: result.affectedRows > 0,
    };
  }

  /**
   * 내가 차단한 회원 목록. 최근에 차단한 순(user_block.id 내림차순)으로 커서 페이지네이션.
   * 탈퇴한 회원은 뺀다.
   */
  async getMyBlockedUsers(
    currentUserId: number,
    { cursor, limit }: BlockListQuery = {},
  ) {
    const safeLimit = Math.min(
      Math.max(limit ?? BLOCK_LIST_DEFAULT_LIMIT, 1),
      BLOCK_LIST_MAX_LIMIT,
    );

    const pageQuery = this.blockRepository
      .createQueryBuilder('block')
      .innerJoin(UserEntity, 'user', 'user.id = block.blockedId')
      .select('block.id', 'blockId')
      .addSelect('block.createdAt', 'blockedAt')
      .addSelect('user.publicId', 'publicId')
      .addSelect('user.userCode', 'userCode')
      .addSelect('user.nickname', 'nickname')
      .addSelect('user.profileImageKey', 'profileImageKey')
      .addSelect('user.defaultProfileImageNo', 'defaultProfileImageNo')
      .where('block.blockerId = :currentUserId', { currentUserId })
      .andWhere('user.withdrawnAt IS NULL')
      .orderBy('block.id', 'DESC')
      .limit(safeLimit + 1);

    if (cursor !== undefined) {
      pageQuery.andWhere('block.id < :cursor', { cursor });
    }

    const rows = await pageQuery.getRawMany<BlockUserRow>();
    const hasNext = rows.length > safeLimit;
    const pageRows = rows.slice(0, safeLimit);
    const lastRow = pageRows[pageRows.length - 1];

    return {
      items: pageRows.map((row) => ({
        id: row.publicId,
        userCode: row.userCode,
        nickname: row.nickname,
        hasProfileImage: !!row.profileImageKey,
        profileImageUrl: this.r2Service.getProfileImageUrl(row),
        blockedAt: row.blockedAt,
      })),
      nextCursor: hasNext && lastRow ? Number(lastRow.blockId) : null,
      hasNext,
    };
  }

  // 두 사람 사이에 차단이 있는지 (누가 차단했든)
  async isBlockedBetween(userA: number, userB: number) {
    const count = await this.blockRepository
      .createQueryBuilder('block')
      .where(
        '(block.blockerId = :userA AND block.blockedId = :userB) OR (block.blockerId = :userB AND block.blockedId = :userA)',
        { userA, userB },
      )
      .getCount();

    return count > 0;
  }

  // 내가 차단했거나 나를 차단한 사람의 id
  async getBlockedPairUserIds(userId: number): Promise<number[]> {
    const rows: Array<{ otherId: string }> = await this.blockRepository.query(
      `SELECT \`blocked_id\` AS otherId FROM \`user_block\` WHERE \`blocker_id\` = ?
        UNION
        SELECT \`blocker_id\` AS otherId FROM \`user_block\` WHERE \`blocked_id\` = ?`,
      [userId, userId],
    );

    return rows.map((row) => Number(row.otherId));
  }
}
