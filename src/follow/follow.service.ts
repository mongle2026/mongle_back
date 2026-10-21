import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FollowEntity } from './entities/follow.entity';
import { UserEntity } from '../user/entities/user.entity';
import { R2Service } from '../storage/r2.service';
import { UserService } from '../user/user.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationStatus } from '../notification/enums/notification.enum';

const FOLLOW_LIST_DEFAULT_LIMIT = 20;
const FOLLOW_LIST_MAX_LIMIT = 50;

type FollowListQuery = { cursor?: number; limit?: number };

// getRawMany 결과는 bigint 가 문자열로 와서 id 는 둘 다 받는다
type FollowUserFields = Pick<
  UserEntity,
  'publicId' | 'userCode' | 'nickname' | 'profileImageKey'
> & { id: number | string };

type FollowUserRow = FollowUserFields & {
  followId: string;
  isFollowingCount: string;
};

@Injectable()
export class FollowService {
  private readonly logger = new Logger(FollowService.name);

  constructor(
    @InjectRepository(FollowEntity)
    private readonly followRepository: Repository<FollowEntity>,

    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,

    private readonly r2Service: R2Service,
    private readonly userService: UserService,
    private readonly notificationService: NotificationService,
  ) {}

  async followUser(currentUserId: number, targetPublicId: string) {
    // DB 왕복 한 번으로 처리한다. publicId 로 찾은 사용자를 그대로 넣는다.
    // 이미 팔로우 중이면 유니크 키에 걸려 아무것도 바뀌지 않는다.
    const result: { affectedRows: number } = await this.followRepository.query(
      `INSERT INTO \`follow\` (\`follower_id\`, \`following_id\`)
        SELECT ?, \`id\` FROM \`user\` WHERE \`public_id\` = ? AND \`id\` <> ?
        ON DUPLICATE KEY UPDATE \`follower_id\` = \`follower_id\``,
      [currentUserId, targetPublicId, currentUserId],
    );

    // 넣은 행이 없으면 이미 팔로우 중이거나, 없는 사용자거나, 나 자신이다
    if (result.affectedRows === 0) {
      const targetUserId =
        await this.userService.getIdByPublicId(targetPublicId);
      this.validateDifferentUser(currentUserId, targetUserId);
    } else {
      void this.notifyFollowed(currentUserId, targetPublicId);
    }

    return {
      followingId: targetPublicId,
      isFollowing: true,
    };
  }

  async unfollowUser(currentUserId: number, targetPublicId: string) {
    // 없는 사용자거나 나 자신이면 지워지는 행이 없을 뿐이라 따로 확인하지 않는다
    const result: { affectedRows: number } = await this.followRepository.query(
      `DELETE \`follow\` FROM \`follow\`
        INNER JOIN \`user\` ON \`user\`.\`id\` = \`follow\`.\`following_id\`
        WHERE \`follow\`.\`follower_id\` = ? AND \`user\`.\`public_id\` = ?`,
      [currentUserId, targetPublicId],
    );

    return {
      followingId: targetPublicId,
      isFollowing: false,
      deleted: result.affectedRows > 0,
    };
  }

  async getFollowStatus(currentUserId: number, targetPublicId: string) {
    const target = await this.userRepository
      .createQueryBuilder('user')
      .select('user.id', 'id')
      .addSelect(
        (subQuery) =>
          subQuery
            .select('COUNT(*)')
            .from(FollowEntity, 'follow')
            .where('follow.followerId = :currentUserId')
            .andWhere('follow.followingId = user.id'),
        'followCount',
      )
      .where('user.publicId = :targetPublicId', { targetPublicId })
      .setParameter('currentUserId', currentUserId)
      .getRawOne<{ id: string; followCount: string }>();

    if (!target) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    const isMe = Number(target.id) === currentUserId;

    return {
      followingId: targetPublicId,
      isFollowing: !isMe && Number(target.followCount) > 0,
      isMe,
    };
  }

  // 내가 팔로우하는 사람
  async getMyFollowings(currentUserId: number, query: FollowListQuery = {}) {
    return this.getFollowUserPage(currentUserId, 'followings', query);
  }

  // 나를 팔로우하는 사람
  async getMyFollowers(currentUserId: number, query: FollowListQuery = {}) {
    return this.getFollowUserPage(currentUserId, 'followers', query);
  }

  /**
   * 팔로우 / 팔로워 목록. 최근에 팔로우한 순(follow.id 내림차순)으로 커서 페이지네이션.
   * isFollowing 은 지금 보는 사람(currentUserId)이 그 사람을 팔로우 중인지다.
   */
  private async getFollowUserPage(
    currentUserId: number,
    type: 'followings' | 'followers',
    { cursor, limit }: FollowListQuery,
  ) {
    const safeLimit = Math.min(
      Math.max(limit ?? FOLLOW_LIST_DEFAULT_LIMIT, 1),
      FOLLOW_LIST_MAX_LIMIT,
    );

    // followings: 내가 누른 행의 상대 / followers: 나를 누른 행의 상대
    const [myColumn, otherColumn] =
      type === 'followings'
        ? ['followerId', 'followingId']
        : ['followingId', 'followerId'];

    const pageQuery = this.followRepository
      .createQueryBuilder('follow')
      .innerJoin(UserEntity, 'user', `user.id = follow.${otherColumn}`)
      .select('follow.id', 'followId')
      .addSelect('user.id', 'id')
      .addSelect('user.publicId', 'publicId')
      .addSelect('user.userCode', 'userCode')
      .addSelect('user.nickname', 'nickname')
      .addSelect('user.profileImageKey', 'profileImageKey')
      .addSelect(
        (subQuery) =>
          subQuery
            .select('COUNT(*)')
            .from(FollowEntity, 'myFollow')
            .where('myFollow.followerId = :currentUserId')
            .andWhere('myFollow.followingId = user.id'),
        'isFollowingCount',
      )
      .where(`follow.${myColumn} = :currentUserId`)
      .setParameter('currentUserId', currentUserId)
      .orderBy('follow.id', 'DESC')
      .limit(safeLimit + 1);

    if (cursor !== undefined) {
      pageQuery.andWhere('follow.id < :cursor', { cursor });
    }

    const rows = await pageQuery.getRawMany<FollowUserRow>();
    const hasNext = rows.length > safeLimit;
    const pageRows = rows.slice(0, safeLimit);
    const lastRow = pageRows[pageRows.length - 1];

    return {
      items: pageRows.map((row) =>
        this.toUserResponse(
          row,
          currentUserId,
          Number(row.isFollowingCount) > 0,
        ),
      ),
      nextCursor: hasNext && lastRow ? Number(lastRow.followId) : null,
      hasNext,
    };
  }

  /**
   * 수신인 선택 화면에서 추천 유저로 사용할 수 있는 목록.
   * 지금은 내가 팔로우한 사람을 반환.
   * 추후에는 자주 보낸 사람, 최근 상호작용한 사람 등을 섞기 좋음.
   */
  async getRecommendedRecipients(currentUserId: number) {
    await this.ensureUserExists(currentUserId);

    const me = await this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.publicId',
        'user.userCode',
        'user.nickname',
        'user.profileImageKey',
      ])
      .where('user.id = :currentUserId', { currentUserId })
      .getOne();

    if (!me) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    const followings = await this.getMyFollowings(currentUserId, {
      limit: FOLLOW_LIST_MAX_LIMIT,
    });

    return [
      this.toUserResponse(me, currentUserId, false),
      ...followings.items,
    ];
  }

  /**
   * 나중에 "내가 팔로우한 사람들의 글만 보기"에서 사용.
   */
  async getFollowingIds(userId: number): Promise<number[]> {
    const rows = await this.followRepository
      .createQueryBuilder('follow')
      .select('follow.followingId', 'followingId')
      .where('follow.followerId = :userId', { userId })
      .getRawMany<{ followingId: string }>();

    return rows.map((row) => Number(row.followingId));
  }

  private async ensureUserExists(userId: number) {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .select(['user.id'])
      .where('user.id = :userId', { userId })
      .getOne();

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    return user;
  }

  // 새로 팔로우했을 때만 보낸다. 응답을 기다리게 하지 않고, 실패해도 팔로우는 성공으로 둔다.
  private async notifyFollowed(currentUserId: number, targetPublicId: string) {
    try {
      const targetUserId =
        await this.userService.getIdByPublicId(targetPublicId);

      await this.notificationService.notify({
        userId: targetUserId,
        status: NotificationStatus.FOLLOW,
        actorId: currentUserId,
      });
    } catch (error) {
      this.logger.error(
        `팔로우 알림 실패 (targetPublicId=${targetPublicId})`,
        error as Error,
      );
    }
  }

  private validateDifferentUser(currentUserId: number, targetUserId: number) {
    if (String(currentUserId) === String(targetUserId)) {
      throw new BadRequestException('자기 자신은 팔로우할 수 없습니다.');
    }
  }

  private toUserResponse(
    user: FollowUserFields,
    currentUserId: number,
    isFollowing: boolean,
  ) {
    return {
      id: user.publicId,
      userCode: user.userCode,
      nickname: user.nickname,
      hasProfileImage: !!user.profileImageKey,
      profileImageUrl: this.r2Service.getProfileImageUrl(
        user.profileImageKey,
      ),
      isMe: String(user.id) === String(currentUserId),
      isFollowing,
    };
  }
}