import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, LessThanOrEqual } from 'typeorm';
import { R2Service } from '../storage/r2.service';
import { ProfileImagePendingEntity } from './entities/profile-image-pending.entity';

// 업로드 URL 을 발급한 뒤 이만큼 지나도 쓰이지 않으면 정리 대상이 된다
const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

// 프로필 사진은 jpg 로 압축해서 올린다. 경로도 .jpg 로 고정
const PROFILE_IMAGE_MIME_TYPE = 'image/jpeg';

// 앱에서 작게 줄여서 올리므로 넉넉한 상한
const MAX_PROFILE_IMAGE_SIZE = 5 * 1024 * 1024;

/**
 * 프로필 사진 업로드.
 *
 * 1. 앱이 업로드 URL 을 받아 R2 에 바로 올린다 (createUploadUrl)
 * 2. 가입/변경 요청에 키를 실어 보내면 확인 후 회원에게 붙인다 (verifyUploaded → attach)
 * 3. 붙지 않은 사진은 정리 크론이 지운다 (purgePendingFiles)
 */
@Injectable()
export class ProfileImageService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly r2Service: R2Service,
  ) {}

  async createUploadUrl() {
    const key = this.r2Service.buildProfileImageKey();

    const uploadUrl = await this.r2Service.createPresignedPutUrl(
      key,
      PROFILE_IMAGE_MIME_TYPE,
    );

    await this.dataSource.manager.save(
      this.dataSource.manager.create(ProfileImagePendingEntity, {
        fileKey: key,
        purgeAfter: new Date(Date.now() + PENDING_UPLOAD_TTL_MS),
      }),
    );

    return { key, uploadUrl, mimeType: PROFILE_IMAGE_MIME_TYPE };
  }

  // 업로드 URL 만 받고 실제로 올리지 않았거나, 너무 큰 파일을 올렸으면 거절한다.
  // R2 요청이라 트랜잭션 밖에서 부른다.
  async verifyUploaded(key: string) {
    const size = await this.r2Service.getObjectSize(key);

    if (size === null) {
      throw new BadRequestException('프로필 사진이 업로드되지 않았습니다.');
    }

    if (size > MAX_PROFILE_IMAGE_SIZE) {
      throw new BadRequestException('프로필 사진은 5MB까지 올릴 수 있습니다.');
    }
  }

  /**
   * 발급했고 아직 쓰이지 않은 키인지 확인하고 대기표에서 뺀다.
   * 회원 저장과 같은 트랜잭션에서 불러서, 저장이 롤백되면 대기표도 되살아나게 한다.
   */
  async attach(manager: EntityManager, key: string) {
    const pending = await manager.findOne(ProfileImagePendingEntity, {
      where: { fileKey: key },
      lock: { mode: 'pessimistic_write' },
    });

    // 올린 적 없는 키이거나 이미 다른 회원에게 쓴 키
    if (!pending) {
      throw new BadRequestException('사용할 수 없는 프로필 사진입니다.');
    }

    await manager.delete(ProfileImagePendingEntity, { id: pending.id });
  }

  /**
   * 정리 대상이 된 사진을 R2 에서 지운다.
   * 삭제에 성공한 행만 지워서, 실패하면 다음 실행 때 다시 시도한다.
   */
  async purgePendingFiles(limit = 100) {
    const targets = await this.dataSource.manager.find(
      ProfileImagePendingEntity,
      {
        where: { purgeAfter: LessThanOrEqual(new Date()) },
        order: { purgeAfter: 'ASC' },
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

      await this.dataSource.manager.delete(ProfileImagePendingEntity, {
        id: target.id,
      });

      deletedCount += 1;
    }

    return { targetCount: targets.length, deletedCount };
  }
}
