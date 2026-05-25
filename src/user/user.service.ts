import { Injectable } from '@nestjs/common';
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

    return this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.username',
        'user.nickname',
        'user.image',
      ])
      .where(
        '(user.nickname LIKE :keyword OR user.username LIKE :keyword)',
        {
          keyword: `%${searchKeyword}%`,
        },
      )
      .orderBy(
        `
      CASE
        WHEN user.nickname LIKE :prefixKeyword THEN 0
        WHEN user.username LIKE :prefixKeyword THEN 1
        WHEN user.nickname LIKE :keyword THEN 2
        WHEN user.username LIKE :keyword THEN 3
        ELSE 4
      END
      `,
        'ASC',
      )
      .addOrderBy('user.nickname', 'ASC')
      .addOrderBy('user.username', 'ASC')
      .setParameter('prefixKeyword', `${searchKeyword}%`)
      .setParameter('keyword', `%${searchKeyword}%`)
      .limit(20)
      .getMany();
  }
}