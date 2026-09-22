// src/database/data-source.ts
import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { RecordEntity } from '../record/entities/record.entity';
import { RecordFileEntity } from '../record/entities/record-file.entity';
import { RecordFilePendingEntity } from '../record/entities/record-file-pending.entity';
import { FeedEntity } from '../feed/entities/feed.entity';
import { LetterEntity } from '../letter/entities/letter.entity';
import { MusicEntity } from '../music/entities/music.entity';
import { PopularMusicEntity } from '../music/entities/popular-music.entity';
import { FeedLikeEntity } from '../like/entities/feed-like.entity';
import { BookmarkEntity } from '../bookmark/entities/bookmark.entity';
import { FeedCommentEntity } from '../feed-comment/entities/feed-comment.entity';
import { FollowEntity } from '../follow/entities/follow.entity';
import { StampEntity } from '../stamp/entities/stamp.entity';
import { NotificationEntity } from '../notification/entities/notification.entity';
import { PushTokenEntity } from '../notification/entities/push-token.entity';
import { NotificationSettingEntity } from '../notification/entities/notification-setting.entity';

export const AppDataSource = new DataSource({
    type: 'mariadb',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: process.env.DB_SSL_CA
        ? { ca: process.env.DB_SSL_CA, rejectUnauthorized: true }
        : process.env.DB_SSL === 'true'
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

    migrations: [__dirname + '/migrations/*.ts'],

    // 초반에만, 얼추되면 false
    synchronize: true,
});