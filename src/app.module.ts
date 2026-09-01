import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';

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
import { FeedCommentEntity } from './feed-comment/entities/feed-comment.entity';
import { FollowModule } from './follow/follow.module';
import { FollowEntity } from './follow/entities/follow.entity';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    StorageModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mariadb',
        host: configService.get<string>('DB_HOST'),
        port: Number(configService.get<string>('DB_PORT')),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_DATABASE'),

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
          FeedCommentEntity,
          FollowEntity,
        ],

        // 초반에만, 얼추되면 false 
        synchronize: true,
      }),
    }),

    UserModule,
    RecordModule,
    FeedModule,
    LetterModule,
    MusicModule,
    LikeModule,
    BookmarkModule,
    FollowModule,
  ],
})
export class AppModule { }