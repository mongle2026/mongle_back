import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedCommentService } from './feed-comment.service';
import { FeedCommentEntity } from './entities/feed-comment.entity';
import { FeedEntity } from 'src/feed/entities/feed.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeedCommentEntity,
      FeedEntity,
    ]),
  ],
  providers: [FeedCommentService],
  exports: [FeedCommentService],
})
export class FeedCommentModule { }
