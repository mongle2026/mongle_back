import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
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

    // DB 왕복 한 번으로 처리한다.
    // 이미 팔로우 중이면 유니크 키에 걸려 아무것도 바뀌지 않고, 없는 사용자면 FK 에러가 난다.
    // (INSERT IGNORE 는 FK 에러까지 삼켜서 쓰지 않는다)
    try {
      await this.followRepository
        .createQueryBuilder()
        .insert()
        .into(FollowEntity)
        .values({
          followerId: currentUserId,
          followingId: targetUserId,
        })
        .orUpdate(['follower_id'], ['follower_id', 'following_id'])
        .execute();
    } catch (error) {
      if (this.isMissingUserError(error)) {
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      }

      throw error;
    }

    return {
      followerId: currentUserId,
      followingId: targetUserId,
      isFollowing: true,
    };
  }

  async unfollowUser(currentUserId: number, targetUserId: number) {
    this.validateDifferentUser(currentUserId, targetUserId);

    // 없는 사용자면 지워지는 행이 없을 뿐이라 따로 확인하지 않는다
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
        'user.profileImageKey',
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

  // MySQL ER_NO_REFERENCED_ROW_2: 참조하는 사용자가 없음
  private isMissingUserError(error: unknown) {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { errno?: number } | undefined)?.errno === 1452
    );
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
      hasProfileImage: !!user.profileImageKey,
      profileImageUrl: this.r2Service.getProfileImageUrl(
        user.profileImageKey,
      ),
      isMe: String(user.id) === String(currentUserId),
      isFollowing,
    };
  }
}