import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, LessThanOrEqual } from 'typeorm';
import { RecordEntity } from './entities/record.entity';
import { RecordFileEntity } from './entities/record-file.entity';
import { RecordFilePendingEntity } from './entities/record-file-pending.entity';
import { RecordFileDto } from './dto/record-file.dto';
import { CreateMusicDto } from '../music/dto/create-music.dto';
import { MusicService } from '../music/music.service';
import { getFileType } from './utils/get-file-type.util';
import { RecordFont } from './enums/record-font.enum';
import { R2Service } from '../storage/r2.service';

// 업로드 URL을 발급하고 이만큼 지나도 첨부되지 않으면 버려진 것으로 본다.
// presigned URL 자체는 5분이면 만료되므로 하루면 넉넉하다.
const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RecordService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly r2Service: R2Service,
    private readonly musicService: MusicService,
  ) {}

  async createBaseRecord(
    manager: EntityManager,
    params: {
      userId: number;
      music: CreateMusicDto;
      text?: string;
      font?: RecordFont;
    },
  ): Promise<RecordEntity> {
    const music = await this.musicService.findOrCreateMusic(params.music, manager);

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
      const music = await this.musicService.findOrCreateMusic(params.music, manager);

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

      await this.detachFiles(
        manager,
        targetFiles.map((file) => ({
          userId: Number(record.userId),
          fileKey: file.fileKey,
          mimeType: file.mimeType,
        })),
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

  /**
   * 업로드용 presigned URL을 발급하고, 발급한 키를 정리 대기표에 남깁니다.
   *
   * 레코드가 아직 없는 시점에 호출되므로 키에 recordId가 들어가지 않습니다.
   * 대신 이 표가 "서버가 이 유저에게 내준 키"라는 증거가 되어,
   * 첨부할 때 소유권 검증에 그대로 쓰입니다.
   */
  async issueUploadUrls(
    manager: EntityManager,
    params: {
      userId: number;
      files: { mimeType: string }[];
    },
  ) {
    const purgeAfter = new Date(Date.now() + PENDING_UPLOAD_TTL_MS);

    const uploads = await Promise.all(
      params.files.map(async (file) => {
        const key = this.r2Service.buildRecordImageKey(
          params.userId,
          file.mimeType,
        );

        return {
          key,
          mimeType: file.mimeType,
          uploadUrl: await this.r2Service.createPresignedPutUrl(
            key,
            file.mimeType,
          ),
        };
      }),
    );

    await manager.save(
      RecordFilePendingEntity,
      uploads.map((upload) =>
        manager.create(RecordFilePendingEntity, {
          userId: params.userId,
          fileKey: upload.key,
          mimeType: upload.mimeType,
          purgeAfter,
        }),
      ),
    );

    return uploads;
  }

  /**
   * 업로드가 끝난 객체를 레코드에 첨부합니다.
   *
   * 반드시 레코드를 만들거나 수정하는 트랜잭션 안에서 호출해야 합니다.
   * 대기 행을 소비하는 DELETE가 같은 트랜잭션에 있어야
   * 롤백될 때 "아직 첨부되지 않았다"는 증거도 함께 되살아납니다.
   */
  async attachFiles(
    manager: EntityManager,
    params: {
      recordId: number;
      userId: number;
      files: RecordFileDto[];
    },
    maxFileCount = 5,
  ) {
    const { recordId, userId, files } = params;

    if (files.length === 0) {
      return [];
    }

    const fileKeys = files.map((file) => file.key);

    if (new Set(fileKeys).size !== fileKeys.length) {
      throw new BadRequestException('같은 파일이 두 번 포함되어 있습니다.');
    }

    const currentFileCount = await manager.count(RecordFileEntity, {
      where: { recordId },
    });

    if (currentFileCount + files.length > maxFileCount) {
      throw new BadRequestException(
        `파일은 최대 ${maxFileCount}개까지 첨부할 수 있습니다.`,
      );
    }

    /*
     * 이 유저에게 실제로 발급했고 아직 쓰이지 않은 키인지 확인합니다.
     * 하나라도 안 맞으면 남의 키 · 올린 적 없는 키 · 이미 쓴 키 중 하나입니다.
     */
    const pendingFiles = await manager.find(RecordFilePendingEntity, {
      where: {
        userId,
        fileKey: In(fileKeys),
      },
      lock: { mode: 'pessimistic_write' },
    });

    if (pendingFiles.length !== files.length) {
      throw new BadRequestException('첨부할 수 없는 파일이 포함되어 있습니다.');
    }

    /*
     * mimeType은 업로드 URL 서명에 박혀 있어 R2가 강제한 값이므로,
     * 클라이언트가 보낸 값 대신 발급 당시의 값을 씁니다.
     */
    const mimeTypeByKey = new Map(
      pendingFiles.map((pendingFile) => [
        pendingFile.fileKey,
        pendingFile.mimeType,
      ]),
    );

    await manager.delete(RecordFilePendingEntity, {
      id: In(pendingFiles.map((pendingFile) => pendingFile.id)),
    });

    const recordFiles = files.map((file) => {
      const mimeType = mimeTypeByKey.get(file.key)!;

      return manager.create(RecordFileEntity, {
        recordId,
        fileType: getFileType(mimeType),
        fileSize: file.size,
        fileKey: file.key,
        mimeType,
        originalName: file.originalName,
      });
    });

    await manager.save(RecordFileEntity, recordFiles);
    await manager.update(RecordEntity, { id: recordId }, { updatedAt: new Date() });

    return recordFiles;
  }

  /**
   * 레코드에서 떨어져 나온 객체를 정리 대기표에 넣습니다.
   *
   * R2 삭제를 트랜잭션 안에서 바로 실행하면, 뒤늦게 롤백됐을 때
   * DB 행은 되살아나는데 객체는 이미 없어져 깨진 참조가 됩니다.
   * 그래서 삭제는 크론에 맡기고 여기서는 대기 행만 남깁니다.
   */
  async detachFiles(
    manager: EntityManager,
    files: { userId: number; fileKey: string; mimeType: string }[],
  ) {
    if (files.length === 0) {
      return;
    }

    await manager
      .createQueryBuilder()
      .insert()
      .into(RecordFilePendingEntity)
      .values(
        files.map((file) => ({
          userId: file.userId,
          fileKey: file.fileKey,
          mimeType: file.mimeType,
          purgeAfter: new Date(),
        })),
      )
      .orIgnore()
      .execute();
  }

  /**
   * 정리 대기 중인 객체를 R2에서 지웁니다.
   *
   * 삭제에 성공한 행만 지워서, 실패하면 다음 실행 때 다시 시도합니다.
   */
  async purgePendingFiles(limit = 100) {
    const targets = await this.dataSource.manager.find(
      RecordFilePendingEntity,
      {
        where: {
          purgeAfter: LessThanOrEqual(new Date()),
        },
        order: {
          purgeAfter: 'ASC',
        },
        take: limit,
      },
    );

    let deletedCount = 0;

    for (const target of targets) {
      try {
        await this.r2Service.deleteObject(target.fileKey);
      } catch {
        continue;
      }

      await this.dataSource.manager.delete(RecordFilePendingEntity, {
        id: target.id,
      });

      deletedCount += 1;
    }

    return {
      message: '정리 대기 중인 파일이 삭제되었습니다.',
      targetCount: targets.length,
      deletedCount,
    };
  }

  private validateFont(font: RecordFont) {
    if (!Object.values(RecordFont).includes(font)) {
      throw new BadRequestException('font 값이 올바르지 않습니다.');
    }
  }
}
