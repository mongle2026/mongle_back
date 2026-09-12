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

    const qb = this.dataSource
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
      )
      .orderBy('letter.id', 'DESC')
      .take(safeLimit + 1)
      .setParameter('userId', userId)
      .setParameter('now', now);

    switch (tab) {
      case LetterboxTab.UNREAD:
        qb.where('letter.receiverId = :userId')
          .andWhere('letter.isRead = false')
          .andWhere(
            '(letter.deliveryAt IS NULL OR letter.deliveryAt <= :now)',
          );
        break;
      case LetterboxTab.RECEIVED:
        qb.where('letter.receiverId = :userId').andWhere(
          '(letter.deliveryAt IS NULL OR letter.deliveryAt <= :now)',
        );
        break;
      case LetterboxTab.SENT:
        qb.where('letter.senderId = :userId');
        break;
      case LetterboxTab.SELF:
        qb.where('letter.senderId = :userId')
          .andWhere('letter.receiverId = :userId')
          .andWhere(
            '(letter.deliveryAt IS NULL OR letter.deliveryAt <= :now)',
          );
        break;
      case LetterboxTab.ALL:
        qb.where(
          new Brackets((w) => {
            w.where('letter.senderId = :userId').orWhere(
              'letter.receiverId = :userId',
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

  private formatLetterboxItem(letter: LetterEntity, userId: number) {
    return {
      letterId: Number(letter.id),
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