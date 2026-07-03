import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';
import { FeedEntity } from './entities/feed.entity';
import { RecordModule } from '../record/record.module';
import { FeedLikeEntity } from 'src/like/entities/feed-like.entity';
import { BookmarkEntity } from 'src/bookmark/entities/bookmark.entity';
import { FeedCleanupService } from './feed-cleanup.service';
import { FeedCommentModule } from 'src/feed-comment/feed-comment.module';
import { FollowModule } from 'src/follow/follow.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeedEntity,
      FeedLikeEntity,
      BookmarkEntity,
    ]),
    RecordModule,
    FollowModule,
    FeedCommentModule,
  ],
  controllers: [FeedController],
  providers: [
    FeedService,
    FeedCleanupService,
  ],
})
export class FeedModule { }