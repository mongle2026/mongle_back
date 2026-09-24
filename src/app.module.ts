import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { RecordModule } from './record/record.module';
import { FeedModule } from './feed/feed.module';
import { LetterModule } from './letter/letter.module';

import { RecordEntity } from './record/entities/record.entity';
import { RecordFileEntity } from './record/entities/record-file.entity';
import { RecordFilePendingEntity } from './record/entities/record-file-pending.entity';
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
import { StampModule } from './stamp/stamp.module';
import { NotificationModule } from './notification/notification.module';
import { StampEntity } from './stamp/entities/stamp.entity';
import { NotificationEntity } from './notification/entities/notification.entity';
import { PushTokenEntity } from './notification/entities/push-token.entity';
import { NotificationSettingEntity } from './notification/entities/notification-setting.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    StorageModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isProduction =
          configService.get<string>('NODE_ENV') === 'production';
        const dbSslCa = configService.get<string>('DB_SSL_CA');
        const useSsl = configService.get<string>('DB_SSL') === 'true';

        return {
          type: 'mysql',
          host: configService.get<string>('DB_HOST'),
          port: Number(configService.get<string>('DB_PORT')),
          username: configService.get<string>('DB_USERNAME'),
          password: configService.get<string>('DB_PASSWORD'),
          database: configService.get<string>('DB_DATABASE'),
          // Aiven 플랜의 max connection 한도를 넘지 않도록 풀 크기 제한
          poolSize: Number(configService.get<string>('DB_POOL_SIZE') ?? 5),
          // DB 는 UTC 로 저장한다. 서버가 도는 컴퓨터의 시간대와 상관없이 UTC 로 읽고 쓰도록 고정
          timezone: 'Z',
          // Aiven은 SSL 연결을 강제하므로 DB_SSL(_CA) 환경변수로 활성화
          ssl: dbSslCa
            ? { ca: dbSslCa, rejectUnauthorized: true }
            : useSsl
              ? { rejectUnauthorized: false }
              : undefined,

          entities: [
            UserEntity,
            RecordEntity,
            RecordFileEntity,
            RecordFilePendingEntity,
            FeedEntity,
            LetterEntity,
            MusicEntity,
            PopularMusicEntity,
            FeedLikeEntity,
            BookmarkEntity,
            FeedCommentEntity,
            FollowEntity,
            StampEntity,
          NotificationEntity,
          PushTokenEntity,
          NotificationSettingEntity,
          ],

          // 초반에만, 얼추되면 false
          synchronize: !isProduction,
        };
      },
    }),

    UserModule,
    RecordModule,
    FeedModule,
    LetterModule,
    MusicModule,
    LikeModule,
    BookmarkModule,
    FollowModule,
    StampModule,
    NotificationModule,
  ],
})
export class AppModule { }