// src/database/data-source.ts
import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { RecordEntity } from '../record/entities/record.entity';
import { RecordFileEntity } from '../record/entities/record-file.entity';
import { RecordFilePendingEntity } from '../record/entities/record-file-pending.entity';
import { ProfileImagePendingEntity } from '../user/entities/profile-image-pending.entity';
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
import { SocialUnlinkPendingEntity } from '../auth/entities/social-unlink-pending.entity';
import { UserBlockEntity } from '../block/entities/user-block.entity';
import { ReportEntity } from '../report/entities/report.entity';
import { RestrictionAppealEntity } from '../report/appeal/entities/restriction-appeal.entity';
import { UserSanctionEntity } from '../report/sanction/entities/user-sanction.entity';
import { BannedAccountEntity } from '../auth/entities/banned-account.entity';
import { MusicPlayEntity } from '../recommendation/entities/music-play.entity';
import { FeedImpressionEntity } from '../recommendation/entities/feed-impression.entity';
import { UserEventEntity } from '../user-event/entities/user-event.entity';

export const AppDataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    // 시각 컬럼은 timestamptz(UTC 저장). 세션 시간대도 UTC 로 고정 (app.module.ts 와 같게)
    extra: { options: '-c TimeZone=UTC' },
    ssl: process.env.DB_SSL_CA
        ? { ca: process.env.DB_SSL_CA, rejectUnauthorized: true }
        : process.env.DB_SSL === 'true'
            ? { rejectUnauthorized: false }
            : undefined,

    entities: [
        UserEntity,
        ProfileImagePendingEntity,
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
        SocialUnlinkPendingEntity,
        UserBlockEntity,
        ReportEntity,
        RestrictionAppealEntity,
        UserSanctionEntity,
        BannedAccountEntity,
        MusicPlayEntity,
        FeedImpressionEntity,
        UserEventEntity,
    ],

    migrations: [__dirname + '/migrations/*.ts'],

    // 마이그레이션 CLI 전용 - 스키마 변경은 마이그레이션으로만 반영
    synchronize: false,
});