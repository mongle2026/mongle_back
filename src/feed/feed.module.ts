import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';
import { FeedEntity } from './entities/feed.entity';
import { RecordModule } from '../record/record.module';
import { FeedLikeEntity } from 'src/like/entities/feed-like.entity';
import { BookmarkEntity } from 'src/bookmark/entities/bookmark.entity';
import { FeedCleanupService } from './feed-cleanup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeedEntity,
      FeedLikeEntity,
      BookmarkEntity,
    ]),
    RecordModule,
  ],
  controllers: [FeedController],
  providers: [FeedService, FeedCleanupService],
})
export class FeedModule {}