import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { RecordEntity } from './entities/record.entity';
import { RecordFileEntity } from './entities/record-file.entity';
import { MusicEntity } from '../music/entities/music.entity';
import { CreateMusicDto } from '../music/dto/create-music.dto';
import { getFileType } from './utils/get-file-type.util';
import { RecordFont } from './enums/record-font.enum';

@Injectable()
export class RecordService {
  async createBaseRecord(
    manager: EntityManager,
    params: {
      userId: number;
      music: CreateMusicDto;
      text?: string;
      font?: RecordFont;
      files: Express.Multer.File[];
    },
  ): Promise<RecordEntity> {
    const music = await this.findOrCreateMusic(manager, params.music);

    const font = params.font ?? RecordFont.KYOBO;

    this.validateFont(font);

    const record = manager.create(RecordEntity, {
      userId: params.userId,
      musicId: music.id,
      text: params.text ?? null,
      font,
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

  async updateBaseRecord(
    manager: EntityManager,
    record: RecordEntity,
    params: {
      text?: string;
      music?: CreateMusicDto;
      font?: RecordFont;
      files: Express.Multer.File[];
      deleteFileIds: number[];
      maxFileCount: number;
      touch?: boolean;
    },
  ): Promise<RecordEntity> {
    let shouldUpdateRecord = false;

    if (params.text !== undefined) {
      record.text = params.text.trim() === '' ? null : params.text;
      shouldUpdateRecord = true;
    }

    if (params.music !== undefined) {
      const music = await this.findOrCreateMusic(manager, params.music);

      record.musicId = music.id;
      shouldUpdateRecord = true;
    }

    if (params.font !== undefined) {
      this.validateFont(params.font);

      record.font = params.font;
      shouldUpdateRecord = true;
    }

    if (params.deleteFileIds.length > 0) {
      const deleteTargetCount = await manager.count(RecordFileEntity, {
        where: {
          id: In(params.deleteFileIds),
          recordId: record.id,
        },
      });

      if (deleteTargetCount !== params.deleteFileIds.length) {
        throw new BadRequestException(
          '삭제할 수 없는 파일이 포함되어 있습니다.',
        );
      }

      await manager.delete(RecordFileEntity, {
        id: In(params.deleteFileIds),
        recordId: record.id,
      });

      shouldUpdateRecord = true;
    }

    const currentFileCount = await manager.count(RecordFileEntity, {
      where: {
        recordId: record.id,
      },
    });

    const nextFileCount = currentFileCount + params.files.length;

    if (nextFileCount > params.maxFileCount) {
      throw new BadRequestException(
        `파일은 최대 ${params.maxFileCount}개까지 첨부할 수 있습니다.`,
      );
    }

    if (params.files.length > 0) {
      const recordFiles = params.files.map((file) =>
        manager.create(RecordFileEntity, {
          recordId: record.id,
          fileType: getFileType(file.mimetype),
          fileSize: file.size,
          fileData: file.buffer,
          mimeType: file.mimetype,
          originalName: file.originalname,
        }),
      );

      await manager.save(RecordFileEntity, recordFiles);

      shouldUpdateRecord = true;
    }

    if (params.touch) {
      shouldUpdateRecord = true;
    }

    if (shouldUpdateRecord) {
      await manager.update(
        RecordEntity,
        {
          id: record.id,
        },
        {
          text: record.text,
          musicId: record.musicId,
          font: record.font,
          updatedAt: new Date(),
        },
      );
    }

    return record;
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

  private validateFont(font: RecordFont) {
    if (!Object.values(RecordFont).includes(font)) {
      throw new BadRequestException('font 값이 올바르지 않습니다.');
    }
  }
}