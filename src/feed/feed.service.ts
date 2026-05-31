import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateMusicDto } from '../music/dto/create-music.dto';
import { CreateFeedDto } from './dto/create-feed.dto';
import { FeedEntity } from './entities/feed.entity';
import { RecordService } from '../record/record.service';
import { EntityManager } from 'typeorm';
import { RecordFileEntity } from 'src/record/entities/record-file.entity';

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


  // 사진 파일 확인 용도 코드
  // 음성도 이걸로 확인가능할듯 
  async findRecordFileById(fileId: number) {
    const file = await this.dataSource.manager.findOne(RecordFileEntity, {
      where: {
        id: fileId,
      },
    });

    if (!file) {
      throw new NotFoundException('파일을 찾을 수 없습니다.');
    }

    console.log('파일 조회 테스트:', {
      id: file.id,
      mimeType: file.mimeType,
      originalName: file.originalName,
      isBuffer: Buffer.isBuffer(file.fileData),
      size: file.fileData?.length,
    });

    return file;
  }

  private parseMusic(music: string): CreateMusicDto {
    try {
      return JSON.parse(music) as CreateMusicDto;
    } catch {
      throw new BadRequestException('music 형식이 올바르지 않습니다.');
    }
  }
}