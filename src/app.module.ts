import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { RecordModule } from './record/record.module';
import { FeedModule } from './feed/feed.module';
import { LetterModule } from './letter/letter.module';

import { RecordEntity } from './record/entities/record.entity';
import { RecordFileEntity } from './record/entities/record-file.entity';
import { FeedEntity } from './feed/entities/feed.entity';
import { LetterEntity } from './letter/entities/letter.entity';
import { MusicModule } from './music/music.module';
import { MusicEntity } from './music/entities/music.entity';
import { UserModule } from './user/user.module';
import { UserEntity } from './user/entities/user.entity';
import { PopularMusicEntity } from './music/entities/popular-music.entity';
import { LikeModule } from './like/like.module';
import { BookmarkModule } from './bookmark/bookmark.module';
import { FeedLikeEntity } from './like/entities/feed-like.entity';
import { BookmarkEntity } from './bookmark/entities/bookmark.entity';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'mariadb',
      host: '127.0.0.1',
      port: 3306,
      username: 'root',
      password: ***REMOVED***,
      database: 'mongle',

      entities: [
        UserEntity,
        RecordEntity,
        RecordFileEntity,
        FeedEntity,
        LetterEntity,
        MusicEntity,
        PopularMusicEntity,
        FeedLikeEntity,
        BookmarkEntity,
      ],

      // 초반에만, 얼추되면 false 
      synchronize: true,
    }),

    UserModule,
    RecordModule,
    FeedModule,
    LetterModule,
    MusicModule,
    LikeModule,
    BookmarkModule,
  ],
})
export class AppModule {}