import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedCommentService } from './feed-comment.service';
import { FeedCommentCleanupService } from './feed-comment-cleanup.service';
import { FeedCommentEntity } from './entities/feed-comment.entity';
import { FeedEntity } from '../feed/entities/feed.entity';
import { NotificationModule } from '../notification/notification.module';
import { BlockModule } from '../block/block.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeedCommentEntity,
      FeedEntity,
    ]),
    NotificationModule,
    BlockModule,
  ],
  providers: [FeedCommentService, FeedCommentCleanupService],
  exports: [FeedCommentService],
})
export class FeedCommentModule { }
