import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecommendationService } from './recommendation.service';
import { MusicPlayEntity } from './entities/music-play.entity';
import { FeedImpressionEntity } from './entities/feed-impression.entity';

// 추천 피드. 사용법 · 적용 방법 · 가중치 조정은 README.md
@Module({
  imports: [TypeOrmModule.forFeature([MusicPlayEntity, FeedImpressionEntity])],
  providers: [RecommendationService],
  exports: [RecommendationService],
})
export class RecommendationModule { }
