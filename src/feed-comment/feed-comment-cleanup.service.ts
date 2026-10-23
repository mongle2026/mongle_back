import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FeedCommentService } from './feed-comment.service';

const BATCH_SIZE = 100;
// 한 번 실행에서 처리할 최대 묶음 수. 남은 댓글은 다음 실행(다음 날)에 이어서 처리한다.
const MAX_BATCHES_PER_RUN = 50;

@Injectable()
export class FeedCommentCleanupService {
  constructor(private readonly feedCommentService: FeedCommentService) {}

  // 다른 정리 크론과 DB 부하가 겹치지 않게 피드 정리(03:00) 10분 뒤에 돈다
  @Cron('10 3 * * *', { timeZone: 'Asia/Seoul' })
  async handleDeletedCommentCleanup() {
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const { targetCount } =
        await this.feedCommentService.purgeDeletedComments(30, BATCH_SIZE);

      if (targetCount < BATCH_SIZE) {
        break;
      }
    }
  }
}
