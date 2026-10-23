import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedCommentService } from './feed-comment.service';
import { FeedCommentCleanupService } from './feed-comment-cleanup.service';
import { FeedCommentEntity } from './entities/feed-comment.entity';
import { FeedEntity } from '../feed/entities/feed.entity';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeedCommentEntity,
      FeedEntity,
    ]),
    NotificationModule,
  ],
  providers: [FeedCommentService, FeedCommentCleanupService],
  exports: [FeedCommentService],
})
export class FeedCommentModule { }
