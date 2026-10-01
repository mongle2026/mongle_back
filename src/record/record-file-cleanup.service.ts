import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RecordService } from './record.service';

@Injectable()
export class RecordFileCleanupService {
  constructor(private readonly recordService: RecordService) {}

  @Cron('0 4 * * *')
  async handlePendingFileCleanup() {
    /*
     * 사진을 고르자마자 미리 올리므로 쓰이지 않은 파일이 하루 100개를 넘을 수 있습니다.
     * 남은 게 없을 때까지 반복하되, 한 번도 지우지 못하면(R2 오류 등) 다음 실행으로 넘깁니다.
     */
    const batchSize = 100;

    for (;;) {
      const { targetCount, deletedCount } =
        await this.recordService.purgePendingFiles(batchSize);

      if (targetCount < batchSize || deletedCount === 0) {
        break;
      }
    }
  }
}
