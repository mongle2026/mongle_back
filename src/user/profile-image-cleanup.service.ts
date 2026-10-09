import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProfileImageService } from './profile-image.service';

@Injectable()
export class ProfileImageCleanupService {
  constructor(private readonly profileImageService: ProfileImageService) {}

  // 레코드 파일 정리(04:00)와 겹치지 않게 30분 뒤에 돈다
  @Cron('30 4 * * *')
  async handlePendingFileCleanup() {
    // 남은 게 없을 때까지 반복하되, 한 번도 지우지 못하면(R2 오류 등) 다음 실행으로 넘긴다
    const batchSize = 100;

    for (;;) {
      const { targetCount, deletedCount } =
        await this.profileImageService.purgePendingFiles(batchSize);

      if (targetCount < batchSize || deletedCount === 0) {
        break;
      }
    }
  }
}
