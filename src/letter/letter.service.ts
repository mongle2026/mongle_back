import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateMusicDto } from '../music/dto/create-music.dto';
import { CreateLetterDto } from './dto/create-letter.dto';
import { LetterEntity } from './entities/letter.entity';
import { RecordService } from '../record/record.service';

@Injectable()
export class LetterService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly recordService: RecordService,
  ) { }

  async createLetter(dto: CreateLetterDto, files: Express.Multer.File[]) {
    const music = this.parseMusic(dto.music);

    return this.dataSource.transaction(async (manager) => {
      const record = await this.recordService.createBaseRecord(manager, {
        userId: Number(dto.userId),
        music,
        text: dto.text,
        files,
      });

      const letter = manager.create(LetterEntity, {
        recordId: record.id,
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

      if (isReceiver && letter.readAt === null) {
        letter.readAt = now;
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
          readAt: letter.readAt,
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

  private parseMusic(music: string): CreateMusicDto {
    try {
      return JSON.parse(music) as CreateMusicDto;
    } catch {
      throw new BadRequestException('music 형식이 올바르지 않습니다.');
    }
  }
}