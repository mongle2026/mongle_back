import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { RecordEntity } from './entities/record.entity';
import { RecordFileEntity } from './entities/record-file.entity';
import { MusicEntity } from '../music/entities/music.entity';
import { CreateMusicDto } from '../music/dto/create-music.dto';
import { getFileType } from './utils/get-file-type.util';
import { RecordFont } from './enums/record-font.enum';
import { R2Service } from '../storage/r2.service';

@Injectable()
export class RecordService {
  constructor(private readonly r2Service: R2Service) {}

  async createBaseRecord(
    manager: EntityManager,
    params: {
      userId: number;
      music: CreateMusicDto;
      text?: string;
      font?: RecordFont;
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

    return savedRecord;
  }

  async updateBaseRecord(
    manager: EntityManager,
    record: RecordEntity,
    params: {
      text?: string;
      music?: CreateMusicDto;
      font?: RecordFont;
      deleteFileIds: number[];
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
      const targetFiles = await manager.find(RecordFileEntity, {
        where: {
          id: In(params.deleteFileIds),
          recordId: record.id,
        },
      });

      if (targetFiles.length !== params.deleteFileIds.length) {
        throw new BadRequestException(
          '삭제할 수 없는 파일이 포함되어 있습니다.',
        );
      }

      await manager.delete(RecordFileEntity, {
        id: In(params.deleteFileIds),
        recordId: record.id,
      });

      await Promise.all(
        targetFiles.map((file) =>
          this.r2Service.deleteObject(file.fileKey).catch(() => undefined),
        ),
      );

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

  async attachFiles(
    manager: EntityManager,
    recordId: number,
    files: { key: string; mimeType: string; size: number; originalName: string }[],
    maxFileCount = 5,
  ) {
    const currentFileCount = await manager.count(RecordFileEntity, {
      where: { recordId },
    });

    if (currentFileCount + files.length > maxFileCount) {
      throw new BadRequestException(
        `파일은 최대 ${maxFileCount}개까지 첨부할 수 있습니다.`,
      );
    }

    const recordFiles = files.map((file) =>
      manager.create(RecordFileEntity, {
        recordId,
        fileType: getFileType(file.mimeType),
        fileSize: file.size,
        fileKey: file.key,
        mimeType: file.mimeType,
        originalName: file.originalName,
      }),
    );

    await manager.save(RecordFileEntity, recordFiles);
    await manager.update(RecordEntity, { id: recordId }, { updatedAt: new Date() });

    return recordFiles;
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