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

@Injectable()
export class FollowService {
  constructor(
    @InjectRepository(FollowEntity)
    private readonly followRepository: Repository<FollowEntity>,

    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,

    private readonly r2Service: R2Service,
  ) {}

  async followUser(currentUserId: number, targetUserId: number) {
    this.validateDifferentUser(currentUserId, targetUserId);

    await this.ensureUserExists(currentUserId);
    await this.ensureUserExists(targetUserId);

    const existingFollow = await this.followRepository.findOne({
      where: {
        followerId: currentUserId,
        followingId: targetUserId,
      },
    });

    if (existingFollow) {
      return {
        followerId: currentUserId,
        followingId: targetUserId,
        isFollowing: true,
      };
    }

    const follow = this.followRepository.create({
      followerId: currentUserId,
      followingId: targetUserId,
    });

    await this.followRepository.save(follow);

    return {
      followerId: currentUserId,
      followingId: targetUserId,
      isFollowing: true,
    };
  }

  async unfollowUser(currentUserId: number, targetUserId: number) {
    this.validateDifferentUser(currentUserId, targetUserId);

    await this.ensureUserExists(currentUserId);
    await this.ensureUserExists(targetUserId);

    const result = await this.followRepository.delete({
      followerId: currentUserId,
      followingId: targetUserId,
    });

    return {
      followerId: currentUserId,
      followingId: targetUserId,
      isFollowing: false,
      deleted: Number(result.affected) > 0,
    };
  }

  async getFollowStatus(currentUserId: number, targetUserId: number) {
    if (String(currentUserId) === String(targetUserId)) {
      return {
        followerId: currentUserId,
        followingId: targetUserId,
        isFollowing: false,
        isMe: true,
      };
    }

    const count = await this.followRepository.count({
      where: {
        followerId: currentUserId,
        followingId: targetUserId,
      },
    });

    return {
      followerId: currentUserId,
      followingId: targetUserId,
      isFollowing: count > 0,
      isMe: false,
    };
  }

  async getFollowingUsers(userId: number) {
    await this.ensureUserExists(userId);

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
        'user.userCode',
        'user.nickname',
        'user.imageMimeType',
        'user.imageUpdatedAt',
      ])
      .orderBy('follow.createdAt', 'DESC')
      .limit(50)
      .getMany();

    return users.map((user) =>
      this.toUserResponse(user, userId, true),
    );
  }

  async getFollowerUsers(userId: number) {
    await this.ensureUserExists(userId);

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
        'user.userCode',
        'user.nickname',
        'user.imageMimeType',
        'user.imageUpdatedAt',
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
        'user.userCode',
        'user.nickname',
        'user.imageMimeType',
        'user.imageUpdatedAt',
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
      id: user.id,
      userCode: user.userCode,
      nickname: user.nickname,
      hasProfileImage: !!user.imageMimeType,
      profileImageUrl: this.r2Service.getProfileImageUrl(
        user.id,
        user.imageMimeType,
        user.imageUpdatedAt,
      ),
      isMe: String(user.id) === String(currentUserId),
      isFollowing,
    };
  }
}