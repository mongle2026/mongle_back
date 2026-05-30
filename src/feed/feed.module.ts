import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';
import { FeedEntity } from './entities/feed.entity';
import { RecordModule } from '../record/record.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FeedEntity]),
    RecordModule,
  ],
  controllers: [FeedController],
  providers: [FeedService],
})
export class FeedModule {}