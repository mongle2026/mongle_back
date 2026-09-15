import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Brackets, DataSource } from 'typeorm';
import { CreateMusicDto } from '../music/dto/create-music.dto';
import { CreateLetterDto } from './dto/create-letter.dto';
import { LetterEntity } from './entities/letter.entity';
import { LetterboxTab } from './enums/letterbox-tab.enum';
import { UserEntity } from '../user/entities/user.entity';
import { RecordService } from '../record/record.service';
import { R2Service } from '../storage/r2.service';

@Injectable()
export class LetterService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly recordService: RecordService,
    private readonly r2Service: R2Service,
  ) { }

  async createLetter(dto: CreateLetterDto) {
    const music = this.parseMusic(dto.music);

    return this.dataSource.transaction(async (manager) => {
      const record = await this.recordService.createBaseRecord(manager, {
        userId: Number(dto.userId),
        music,
        text: dto.text,
      });

      const letter = manager.create(LetterEntity, {
        recordId: record.id,
        senderId: Number(dto.userId),
        receiverId: Number(dto.receiverId),
        deliveryAt: dto.deliveryAt ? new Date(dto.deliveryAt) : null,
        pattern: dto.pattern,
        color: dto.color,
        stamp: dto.stamp,
      });

      const savedLetter = await manager.save(LetterEntity, letter);

      return {
        message: '편지가 생성되었습니다.',
        recordId: record.id,
        letterId: savedLetter.id,
      };
    });
  }

  async getLetterDetail(params: {
    letterId: number;
    userId: number;
  }) {
    const { letterId, userId } = params;

    if (!letterId || Number.isNaN(letterId)) {
      throw new BadRequestException('letterId가 올바르지 않습니다.');
    }

    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('userId가 올바르지 않습니다.');
    }

    return this.dataSource.transaction(async (manager) => {
      const letter = await manager
        .getRepository(LetterEntity)
        .createQueryBuilder('letter')
        .leftJoinAndSelect('letter.record', 'record')
        .leftJoinAndSelect('record.user', 'sender')
        .leftJoinAndSelect('record.music', 'music')
        .leftJoinAndSelect('record.files', 'files')
        .leftJoinAndMapOne(
          'letter.receiver',
          UserEntity,
          'receiver',
          'receiver.id = letter.receiverId',
        )
        .where('letter.id = :letterId', { letterId })
        .orderBy('files.id', 'ASC')
        .getOne();

      if (!letter) {
        throw new NotFoundException('편지를 찾을 수 없습니다.');
      }

      const senderId = Number(letter.record.userId);
      const receiverId = Number(letter.receiverId);

      const isSender = senderId === userId;
      const isReceiver = receiverId === userId;

      if (!isSender && !isReceiver) {
        throw new ForbiddenException('편지를 열람할 권한이 없습니다.');
      }

      if (this.isDeletedByUser(letter, userId)) {
        throw new NotFoundException('편지를 찾을 수 없습니다.');
      }

      const now = new Date();
      const isDelivered =
        letter.deliveryAt === null || letter.deliveryAt <= now;

      if (isReceiver && !isDelivered) {
        throw new ForbiddenException('아직 열람할 수 없는 편지입니다.');
      }

      if (isReceiver && !letter.isRead) {
        letter.isRead = true;
        await manager.save(LetterEntity, letter);
      }

      return {
        letter: {
          id: Number(letter.id),
          recordId: Number(letter.recordId),
          receiverId: Number(letter.receiverId),
          receiver: this.formatLetterboxUser(letter.receiver),
          pattern: letter.pattern,
          color: letter.color,
          stamp: letter.stamp,
          deliveryAt: letter.deliveryAt,
          isRead: letter.isRead,
        },
        record: {
          id: Number(letter.record.id),
          userId: Number(letter.record.userId),
          musicId: Number(letter.record.musicId),
          text: letter.record.text,
          createdAt: letter.record.createdAt,
          updatedAt: letter.record.updatedAt,
          user: letter.record.user
            ? {
              id: Number(letter.record.user.id),
              nickname: letter.record.user.nickname,
              profileImageUrl: this.r2Service.getProfileImageUrl(
                letter.record.user.id,
                letter.record.user.imageMimeType,
                letter.record.user.imageUpdatedAt,
              ),
            }
            : null,
          music: letter.record.music,
          files: letter.record.files?.map((file) => ({
            id: Number(file.id),
            recordId: Number(file.recordId),
            url: this.r2Service.getPublicUrl(file.fileKey),
            fileType: file.fileType,
            fileSize: Number(file.fileSize),
            mimeType: file.mimeType,
            originalName: file.originalName,
            createdAt: file.createdAt,
          })) ?? [],
        },
      };
    });
  }

  async getLetterbox(params: {
    userId: number;
    tab: LetterboxTab;
    cursor?: number;
    limit?: number;
  }) {
    const { userId, tab, cursor } = params;

    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('userId가 올바르지 않습니다.');
    }

    if (cursor !== undefined && (!cursor || Number.isNaN(cursor))) {
      throw new BadRequestException('cursor 값이 올바르지 않습니다.');
    }

    const safeLimit = Math.min(Math.max(params.limit ?? 20, 1), 50);
    const now = new Date();

    const qb = this.createLetterboxQueryBuilder()
      .orderBy('letter.id', 'DESC')
      // 조인이 전부 N:1이라 행이 늘어나지 않는다. take()를 쓰면 TypeORM이 id만 뽑는
      // DISTINCT 쿼리를 한 번 더 날리므로, 왕복 한 번으로 끝나는 limit()을 쓴다.
      .limit(safeLimit + 1)
      .setParameter('userId', userId)
      .setParameter('now', now);

    // 내가 삭제한 편지는 내 편지함에서만 빠진다 (sender/receiverDeletedAt)
    switch (tab) {
      case LetterboxTab.UNREAD:
        qb.where('letter.receiverId = :userId')
          .andWhere('letter.receiverDeletedAt IS NULL')
          .andWhere('letter.isRead = false')
          .andWhere(
            '(letter.deliveryAt IS NULL OR letter.deliveryAt <= :now)',
          );
        break;
      case LetterboxTab.RECEIVED:
        qb.where('letter.receiverId = :userId')
          .andWhere('letter.receiverDeletedAt IS NULL')
          .andWhere('letter.senderId != :userId')
          .andWhere(
            '(letter.deliveryAt IS NULL OR letter.deliveryAt <= :now)',
          );
        break;
      case LetterboxTab.SENT:
        qb.where('letter.senderId = :userId')
          .andWhere('letter.senderDeletedAt IS NULL')
          .andWhere('letter.receiverId != :userId');
        break;
      case LetterboxTab.SELF:
        qb.where('letter.senderId = :userId')
          .andWhere('letter.receiverId = :userId')
          .andWhere('letter.senderDeletedAt IS NULL')
          .andWhere(
            '(letter.deliveryAt IS NULL OR letter.deliveryAt <= :now)',
          );
        break;
      case LetterboxTab.ALL:
        qb.where(
          new Brackets((w) => {
            w.where(
              '(letter.senderId = :userId AND letter.senderDeletedAt IS NULL)',
            ).orWhere(
              '(letter.receiverId = :userId AND letter.receiverDeletedAt IS NULL)',
            );
          }),
        ).andWhere(
          '(letter.receiverId != :userId OR letter.deliveryAt IS NULL OR letter.deliveryAt <= :now)',
        );
        break;
      default:
        throw new BadRequestException('tab 값이 올바르지 않습니다.');
    }

    if (cursor !== undefined) {
      qb.andWhere('letter.id < :cursor', { cursor });
    }

    const rows = await qb.getMany();
    const hasNext = rows.length > safeLimit;
    const items = (hasNext ? rows.slice(0, safeLimit) : rows).map((letter) =>
      this.formatLetterboxItem(letter, userId),
    );
    const lastItem = items[items.length - 1];

    return {
      items,
      nextCursor: hasNext && lastItem ? lastItem.letterId : null,
      hasNext,
    };
  }

  // 우표 상세의 편지 목록. 이 우표가 붙은 "수집한 편지"를 도착 시각이 최근인 순으로 준다.
  // 수집한 편지 = 나에게 도착한 편지(나에게 쓴 편지 포함), 내가 삭제한 편지는 제외.
  // (StampService.getStampCollection의 count와 같은 조건)
  async getCollectedLettersByStamp(params: { userId: number; stamp: string }) {
    const { userId, stamp } = params;

    const rows = await this.createLetterboxQueryBuilder()
      .where('letter.receiverId = :userId', { userId })
      .andWhere('letter.stamp = :stamp', { stamp })
      .andWhere('letter.receiverDeletedAt IS NULL')
      .andWhere('(letter.deliveryAt IS NULL OR letter.deliveryAt <= :now)', {
        now: new Date(),
      })
      .getMany();

    return rows
      .map((letter) => ({
        ...this.formatLetterboxItem(letter, userId),
        // 도착 시각. 예약 없이 보낸 편지(deliveryAt null)는 보낸 즉시 도착한다.
        arrivedAt: letter.deliveryAt ?? letter.record.createdAt,
      }))
      .sort(
        (a, b) =>
          b.arrivedAt.getTime() - a.arrivedAt.getTime() ||
          b.letterId - a.letterId,
      );
  }

  // 편지 삭제. 삭제한 사람의 편지함에서만 숨기고, 상대방 편지함에는 그대로 남긴다.
  // 단, 도착 전 편지를 보낸 사람이 삭제하면 받는 사람에게도 도착하지 않는다.
  async deleteLetter(params: { letterId: number; userId: number }) {
    const { letterId, userId } = params;

    if (!letterId || Number.isNaN(letterId)) {
      throw new BadRequestException('letterId가 올바르지 않습니다.');
    }

    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('userId가 올바르지 않습니다.');
    }

    return this.dataSource.transaction(async (manager) => {
      const letter = await manager.findOne(LetterEntity, {
        where: { id: letterId },
      });

      if (!letter) {
        throw new NotFoundException('삭제할 편지를 찾을 수 없습니다.');
      }

      const isSender = Number(letter.senderId) === userId;
      const isReceiver = Number(letter.receiverId) === userId;

      if (!isSender && !isReceiver) {
        throw new ForbiddenException('편지를 삭제할 권한이 없습니다.');
      }

      const now = new Date();
      const isDelivered =
        letter.deliveryAt === null || letter.deliveryAt <= now;

      // 이미 삭제했거나, 받는 사람 입장에서 아직 도착하지 않은 편지는 편지함에 없는 편지다
      if (this.isDeletedByUser(letter, userId) || (!isSender && !isDelivered)) {
        throw new NotFoundException('삭제할 편지를 찾을 수 없습니다.');
      }

      // 도착 전에 보낸 사람이 삭제한 편지는 발송 취소로 보고, 받는 사람에게도 도착하지 않게
      // 양쪽을 함께 삭제한다. 나에게 쓴 편지도 보낸/받은 쪽을 함께 삭제한다.
      const deleteForReceiver = isReceiver || (isSender && !isDelivered);

      await manager.update(
        LetterEntity,
        { id: letterId },
        {
          ...(isSender && { senderDeletedAt: now }),
          ...(deleteForReceiver && { receiverDeletedAt: now }),
        },
      );

      return {
        message: '편지가 삭제되었습니다.',
        letterId,
      };
    });
  }

  // 편지함 목록 아이템(formatLetterboxItem)을 만들 때 필요한 조인
  private createLetterboxQueryBuilder() {
    return this.dataSource
      .getRepository(LetterEntity)
      .createQueryBuilder('letter')
      .leftJoinAndSelect('letter.record', 'record')
      .leftJoinAndSelect('record.user', 'sender')
      .leftJoinAndSelect('record.music', 'music')
      .leftJoinAndMapOne(
        'letter.receiver',
        UserEntity,
        'receiver',
        'receiver.id = letter.receiverId',
      );
  }

  private isDeletedByUser(letter: LetterEntity, userId: number) {
    const isSender = Number(letter.senderId) === userId;
    const isReceiver = Number(letter.receiverId) === userId;

    return (
      (isSender && letter.senderDeletedAt !== null) ||
      (isReceiver && letter.receiverDeletedAt !== null)
    );
  }

  private formatLetterboxItem(letter: LetterEntity, userId: number) {
    return {
      letterId: Number(letter.id),
      // 보낸 시각 = 작성해서 보낸 시각. letter와 record는 같은 트랜잭션에서 생성된다.
      createdAt: letter.record.createdAt,
      deliveryAt: letter.deliveryAt,
      isRead: letter.isRead,
      isSender: Number(letter.senderId) === userId,
      isReceiver: Number(letter.receiverId) === userId,
      envelope: {
        pattern: letter.pattern,
        color: letter.color,
        stamp: letter.stamp,
      },
      sender: this.formatLetterboxUser(letter.record.user),
      receiver: this.formatLetterboxUser(letter.receiver),
      music: letter.record.music
        ? {
          musicId: Number(letter.record.music.id),
          musicTitle: letter.record.music.musicTitle,
          musicArtist: letter.record.music.musicArtist,
          musicArtwork: letter.record.music.musicArtwork,
        }
        : null,
    };
  }

  private formatLetterboxUser(user?: UserEntity | null) {
    if (!user) {
      return null;
    }

    return {
      userId: Number(user.id),
      nickname: user.nickname,
      profileImageUrl: this.r2Service.getProfileImageUrl(
        user.id,
        user.imageMimeType,
        user.imageUpdatedAt,
      ),
    };
  }

  private parseMusic(music: string): CreateMusicDto {
    try {
      return JSON.parse(music) as CreateMusicDto;
    } catch {
      throw new BadRequestException('music 형식이 올바르지 않습니다.');
    }
  }
}