import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MusicService } from './music.service';
import { MusicController } from './music.controller';
import { MusicEntity } from './entities/music.entity';
import { PopularMusicEntity } from './entities/popular-music.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MusicEntity,
      PopularMusicEntity,
    ]),
  ],
  controllers: [MusicController],
  providers: [MusicService],
  exports: [MusicService],
})
export class MusicModule { }