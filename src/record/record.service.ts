import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { RecordEntity } from './entities/record.entity';
import { RecordFileEntity } from './entities/record-file.entity';
import { MusicEntity } from '../music/entities/music.entity';
import { CreateMusicDto } from '../music/dto/create-music.dto';
import { getFileType } from './utils/get-file-type.util';

@Injectable()
export class RecordService {
  async createBaseRecord(
    manager: EntityManager,
    params: {
      userId: number;
      music: CreateMusicDto;
      text?: string;
      files: Express.Multer.File[];
    },
  ): Promise<RecordEntity> {
    const music = await this.findOrCreateMusic(manager, params.music);

    const record = manager.create(RecordEntity, {
      userId: params.userId,
      musicId: music.id,
      text: params.text ?? null,
    });

    const savedRecord = await manager.save(RecordEntity, record);

    if (params.files.length > 0) {
      const recordFiles = params.files.map((file) =>
        manager.create(RecordFileEntity, {
          recordId: savedRecord.id,
          fileType: getFileType(file.mimetype),
          fileSize: file.size,
          fileData: file.buffer,
          mimeType: file.mimetype,
          originalName: file.originalname,
        }),
      );

      await manager.save(RecordFileEntity, recordFiles);
    }

    return savedRecord;
  }

  private async findOrCreateMusic(
    manager: EntityManager,
    dto: CreateMusicDto,
  ): Promise<MusicEntity> {
    const existingMusic = await manager.findOne(MusicEntity, {
      where: {
        externalId: dto.externalId,
      },
    });

    if (existingMusic) {
      return existingMusic;
    }

    const music = manager.create(MusicEntity, {
      externalId: dto.externalId,
      musicTitle: dto.musicTitle,
      musicArtist: dto.musicArtist,
      musicGenre: dto.musicGenre ?? null,
      musicArtwork: dto.musicArtwork ?? null,
      previewUrl: dto.previewUrl ?? null,
    });

    return manager.save(MusicEntity, music);
  }
}