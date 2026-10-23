import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FeedService } from './feed.service';

const BATCH_SIZE = 100;
// 한 번 실행에서 처리할 최대 묶음 수. 남은 피드는 다음 실행(다음 날)에 이어서 처리한다.
const MAX_BATCHES_PER_RUN = 50;

@Injectable()
export class FeedCleanupService {
  constructor(private readonly feedService: FeedService) {}

  // 첨부 파일은 정리 대기표로만 넘기므로 레코드 파일 정리(03:40)보다 먼저 돈다
  @Cron('0 3 * * *', { timeZone: 'Asia/Seoul' })
  async handleDeletedFeedCleanup() {
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const { targetCount } = await this.feedService.purgeDeletedFeeds(
        30,
        BATCH_SIZE,
      );

      if (targetCount < BATCH_SIZE) {
        break;
      }
    }
  }
}
