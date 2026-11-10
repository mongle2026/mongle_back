import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MusicService } from './music.service';
import { MusicController } from './music.controller';
import { AppleMusicTokenService } from './apple-music-token.service';
import { MusicEntity } from './entities/music.entity';
import { PopularMusicEntity } from './entities/popular-music.entity';
import { RecommendationModule } from '../recommendation/recommendation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MusicEntity,
      PopularMusicEntity,
    ]),
    RecommendationModule,
  ],
  controllers: [MusicController],
  providers: [MusicService, AppleMusicTokenService],
  exports: [MusicService],
})
export class MusicModule { }