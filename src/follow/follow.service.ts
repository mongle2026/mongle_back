import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FollowEntity } from './entities/follow.entity';
import { UserEntity } from '../user/entities/user.entity';
import { R2Service } from '../storage/r2.service';
import { UserService } from '../user/user.service';

@Injectable()
export class FollowService {
  constructor(
    @InjectRepository(FollowEntity)
    private readonly followRepository: Repository<FollowEntity>,

    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,

    private readonly r2Service: R2Service,
    private readonly userService: UserService,
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

  // 앱은 publicId 로 회원을 가리킨다
  async getFollowingUsersByPublicId(publicId: string) {
    return this.getFollowingUsers(
      await this.userService.getIdByPublicId(publicId),
    );
  }

  async getFollowerUsersByPublicId(publicId: string) {
    return this.getFollowerUsers(
      await this.userService.getIdByPublicId(publicId),
    );
  }

  private async getFollowingUsers(userId: number) {
    const users = await this.userRepository
      .createQueryBuilder('user')
      .innerJoin(
        FollowEntity,
        'follow',
        'follow.following_id = user.id AND follow.follower_id = :userId',
        { userId },
      )
      .select([
        'user.id',
        'user.publicId',
        'user.userCode',
        'user.nickname',
        'user.profileImageKey',
      ])
      .orderBy('follow.createdAt', 'DESC')
      .limit(50)
      .getMany();

    return users.map((user) =>
      this.toUserResponse(user, userId, true),
    );
  }

  private async getFollowerUsers(userId: number) {
    const users = await this.userRepository
      .createQueryBuilder('user')
      .innerJoin(
        FollowEntity,
        'follow',
        'follow.follower_id = user.id AND follow.following_id = :userId',
        { userId },
      )
      .select([
        'user.id',
        'user.publicId',
        'user.userCode',
        'user.nickname',
        'user.profileImageKey',
      ])
      .orderBy('follow.createdAt', 'DESC')
      .limit(50)
      .getMany();

    const followingIdSet = await this.getFollowingIdSet(userId);

    return users.map((user) =>
      this.toUserResponse(
        user,
        userId,
        followingIdSet.has(String(user.id)),
      ),
    );
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

    const followings = await this.getFollowingUsers(currentUserId);

    return [
      this.toUserResponse(me, currentUserId, false),
      ...followings,
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

  private async getFollowingIdSet(userId: number) {
    const followingIds = await this.getFollowingIds(userId);
    return new Set(followingIds.map((id) => String(id)));
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

  private validateDifferentUser(currentUserId: number, targetUserId: number) {
    if (String(currentUserId) === String(targetUserId)) {
      throw new BadRequestException('자기 자신은 팔로우할 수 없습니다.');
    }
  }

  private toUserResponse(
    user: UserEntity,
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