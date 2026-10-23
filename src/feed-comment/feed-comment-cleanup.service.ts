import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FeedCommentService } from './feed-comment.service';

@Injectable()
export class FeedCommentCleanupService {
  constructor(private readonly feedCommentService: FeedCommentService) {}

  @Cron('10 3 * * *')
  async handleDeletedCommentCleanup() {
    const batchSize = 100;

    for (;;) {
      const { targetCount } =
        await this.feedCommentService.purgeDeletedComments(30, batchSize);

      if (targetCount < batchSize) {
        break;
      }
    }
  }
}
