import { BadRequestException, Injectable } from '@nestjs/common';
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
        // senderId: Number(dto.senderId),
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

  private parseMusic(music: string): CreateMusicDto {
    try {
      return JSON.parse(music) as CreateMusicDto;
    } catch {
      throw new BadRequestException('music 형식이 올바르지 않습니다.');
    }
  }
}