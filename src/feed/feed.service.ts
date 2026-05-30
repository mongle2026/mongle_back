import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateMusicDto } from '../music/dto/create-music.dto';
import { CreateFeedDto } from './dto/create-feed.dto';
import { FeedEntity } from './entities/feed.entity';
import { RecordService } from '../record/record.service';

@Injectable()
export class FeedService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly recordService: RecordService,
  ) { }

  async createFeed(dto: CreateFeedDto, files: Express.Multer.File[]) {
    const music = this.parseMusic(dto.music);

    return this.dataSource.transaction(async (manager) => {
      const record = await this.recordService.createBaseRecord(manager, {
        userId: Number(dto.userId),
        music,
        text: dto.text,
        files,
      });

      const feed = manager.create(FeedEntity, {
        recordId: record.id,
        visibility: dto.visibility,
      });

      const savedFeed = await manager.save(FeedEntity, feed);

      return {
        message: '게시글이 생성되었습니다.',
        recordId: record.id,
        feedId: savedFeed.id,
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