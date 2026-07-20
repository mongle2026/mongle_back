import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) { }

  async searchUsers(
    keyword: string,
    currentUserId: number,
    page: number = 1,
    limit: number = 20,
  ) {
    const searchKeyword = keyword?.trim() ?? '';

    if (!searchKeyword) {
      return await this.getDefaultRecipients(
        currentUserId,
        page,
      );
    }

    const skip = (page - 1) * limit;

    const users = await this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.userCode',
        'user.nickname',
        'user.imageMimeType',
      ])
      .where(
        `
        (
          user.nickname LIKE :keyword
          OR user.userCode LIKE :keyword
        )
      `,
        {
          keyword: `%${searchKeyword}%`,
        },
      )
      .orderBy(
        `
        CASE
          WHEN user.id = :currentUserId THEN 0
          ELSE 1
        END
      `,
        'ASC',
      )
      .addOrderBy(
        `
        CASE
          WHEN user.nickname LIKE :prefixKeyword THEN 0
          WHEN user.userCode LIKE :prefixKeyword THEN 1
          WHEN user.nickname LIKE :keyword THEN 2
          WHEN user.userCode LIKE :keyword THEN 3
          ELSE 4
        END
      `,
        'ASC',
      )
      .addOrderBy('user.nickname', 'ASC')
      .addOrderBy('user.userCode', 'ASC')
      .addOrderBy('user.id', 'ASC')
      .setParameter('currentUserId', currentUserId)
      .setParameter(
        'prefixKeyword',
        `${searchKeyword}%`,
      )
      .setParameter(
        'keyword',
        `%${searchKeyword}%`,
      )
      .skip(skip)
      .take(limit + 1)
      .getMany();

    const hasNextPage = users.length > limit;
    const currentPageUsers = users.slice(0, limit);

    return {
      items: currentPageUsers.map((user) =>
        this.toRecipientResponse(user, currentUserId),
      ),
      page,
      nextPage: hasNextPage ? page + 1 : null,
      hasNextPage,
    };
  }

  private async getDefaultRecipients(
    currentUserId: number,
    page: number,
  ) {
    if (page > 1) {
      return {
        items: [],
        page,
        nextPage: null,
        hasNextPage: false,
      };
    }

    const me = await this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.userCode',
        'user.nickname',
        'user.imageMimeType',
      ])
      .where('user.id = :currentUserId', {
        currentUserId,
      })
      .getOne();

    if (!me) {
      throw new NotFoundException(
        '사용자를 찾을 수 없습니다.',
      );
    }

    return {
      items: [
        this.toRecipientResponse(
          me,
          currentUserId,
        ),
      ],
      page: 1,
      nextPage: null,
      hasNextPage: false,
    };
  }

  private toRecipientResponse(user: UserEntity, currentUserId: number) {
    return {
      id: user.id,
      userCode: user.userCode,
      nickname: user.nickname,
      hasProfileImage: !!user.imageMimeType,
      profileImageUrl: user.imageMimeType
        ? `/user/${user.id}/profile-image`
        : null,
      isMe: String(user.id) === String(currentUserId),
    };
  }

  async getProfileImage(userId: number) {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.imageData')
      .where('user.id = :userId', { userId })
      .getOne();

    if (!user || !user.imageData) {
      throw new NotFoundException('프로필 이미지가 없습니다.');
    }

    return {
      imageData: user.imageData,
      imageMimeType: user.imageMimeType ?? 'image/jpeg',
    };
  }
}