import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { UserEntity } from './entities/user.entity';
import { R2Service } from '../storage/r2.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { isDuplicateEntryError } from '../database/mysql-error.util';
import { ProfileImageService } from './profile-image.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly r2Service: R2Service,
    private readonly dataSource: DataSource,
    private readonly profileImageService: ProfileImageService,
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
        'user.publicId',
        'user.userCode',
        'user.nickname',
        'user.profileImageKey',
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
      .andWhere('user.withdrawnAt IS NULL')
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

  // 앱이 보낸 publicId 를 서버 안에서 쓰는 user.id 로 바꾼다.
  // 탈퇴한 회원은 없는 회원으로 본다 (편지 보내기, 팔로우 대상이 될 수 없다)
  async getIdByPublicId(publicId: string): Promise<number> {
    const user = await this.userRepository.findOne({
      select: { id: true },
      where: { publicId, withdrawnAt: IsNull() },
    });

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    return Number(user.id);
  }

  async getUserById(userId: number) {
    return this.getUserProfile({ id: userId });
  }

  // 다른 사람 프로필 조회. 앱은 publicId 로만 회원을 가리킨다.
  async getUserByPublicId(publicId: string) {
    return this.getUserProfile({ publicId });
  }

  // 탈퇴한 회원의 프로필은 없다
  private async getUserProfile(where: { id: number } | { publicId: string }) {
    const user = await this.userRepository.findOne({
      select: {
        id: true,
        publicId: true,
        userCode: true,
        nickname: true,
        profileImageKey: true,
      },
      where: { ...where, withdrawnAt: IsNull() },
    });

    if (!user) {
      throw new NotFoundException(
        '사용자를 찾을 수 없습니다.',
      );
    }

    return {
      userId: user.publicId,
      userCode: user.userCode,
      nickname: user.nickname,

      hasProfileImage:
        !!user.profileImageKey,

      profileImageUrl: this.r2Service.getProfileImageUrl(
        user.profileImageKey,
      ),
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
        'user.publicId',
        'user.userCode',
        'user.nickname',
        'user.profileImageKey',
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

  /**
   * 프로필 수정. 보낸 항목만 한 트랜잭션으로 바꿔서, 하나라도 실패하면 아무것도 바뀌지 않는다.
   *
   * profileImageKey: 보내지 않으면 그대로, 새 키면 그 사진으로, null 이면 사진 삭제.
   * 바꾸거나 지운 예전 사진은 대기표로 돌려서 정리 크론이 지운다.
   */
  async updateProfile(userId: number, dto: UpdateUserDto) {
    const changes: Partial<
      Pick<UserEntity, 'nickname' | 'userCode' | 'profileImageKey'>
    > = {};

    if (dto.nickname !== undefined) {
      changes.nickname = dto.nickname;
    }

    if (dto.userCode !== undefined) {
      changes.userCode = dto.userCode;
    }

    if (dto.profileImageKey !== undefined) {
      changes.profileImageKey = dto.profileImageKey;
    }

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('변경할 항목이 없습니다.');
    }

    // 내 아이디의 대소문자만 바꾸는 경우는 허용되도록 나는 빼고 확인한다
    if (
      dto.userCode !== undefined &&
      (await this.userRepository.existsBy({
        userCode: dto.userCode,
        id: Not(userId),
      }))
    ) {
      throw new ConflictException('이미 사용 중인 아이디입니다.');
    }

    // R2 요청이라 트랜잭션 밖에서 확인한다
    if (changes.profileImageKey) {
      await this.profileImageService.verifyUploaded(changes.profileImageKey);
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        // 사진을 연달아 바꿔도 예전 키를 놓치지 않게 내 행을 잠그고 읽는다
        const user = await manager.findOne(UserEntity, {
          select: { id: true, profileImageKey: true },
          where: { id: userId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!user) {
          throw new NotFoundException('사용자를 찾을 수 없습니다.');
        }

        if (changes.profileImageKey !== undefined) {
          // 지금 사진과 같으면 바꾸지 않는다. 이미 붙은 키라 attach 하면 거절된다
          if (changes.profileImageKey === user.profileImageKey) {
            delete changes.profileImageKey;
          } else {
            if (changes.profileImageKey) {
              await this.profileImageService.attach(
                manager,
                changes.profileImageKey,
              );
            }

            if (user.profileImageKey) {
              await this.profileImageService.discard(
                manager,
                user.profileImageKey,
              );
            }
          }
        }

        if (Object.keys(changes).length > 0) {
          await manager.update(UserEntity, { id: userId }, changes);
        }
      });
    } catch (error) {
      // 위 확인과 저장 사이에 다른 사람이 같은 아이디를 가져간 경우
      if (isDuplicateEntryError(error)) {
        throw new ConflictException('이미 사용 중인 아이디입니다.');
      }

      throw error;
    }

    return this.getUserById(userId);
  }

  private toRecipientResponse(user: UserEntity, currentUserId: number) {
    return {
      id: user.publicId,
      userCode: user.userCode,
      nickname: user.nickname,
      hasProfileImage: !!user.profileImageKey,
      profileImageUrl: this.r2Service.getProfileImageUrl(
        user.profileImageKey,
      ),
      isMe: String(user.id) === String(currentUserId),
    };
  }
}