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

  async searchUsers(keyword: string) {
    if (!keyword || keyword.trim() === '') {
      return [];
    }

    const searchKeyword = keyword.trim();

    const users = await this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.userCode',
        'user.nickname',
        'user.imageMimeType',
      ])
      .where(
        '(user.nickname LIKE :keyword OR user.userCode LIKE :keyword)',
        {
          keyword: `%${searchKeyword}%`,
        },
      )
      .orderBy(
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
      .setParameter('prefixKeyword', `${searchKeyword}%`)
      .setParameter('keyword', `%${searchKeyword}%`)
      .limit(20)
      .getMany();

    return users.map((user) => ({
      id: user.id,
      userCode: user.userCode,
      nickname: user.nickname,
      hasProfileImage: !!user.imageMimeType,
      profileImageUrl: user.imageMimeType
        ? `/user/${user.id}/profile-image`
        : null,
    }));
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