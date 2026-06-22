import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FeedService } from './feed.service';

@Injectable()
export class FeedCleanupService {
  constructor(private readonly feedService: FeedService) {}

  @Cron('0 3 * * *')
  async handleDeletedFeedCleanup() {
    await this.feedService.purgeDeletedFeeds(30, 100);
  }
}