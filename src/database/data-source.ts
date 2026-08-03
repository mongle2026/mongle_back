// src/database/data-source.ts
import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { RecordEntity } from '../record/entities/record.entity';
import { RecordFileEntity } from '../record/entities/record-file.entity';
import { FeedEntity } from '../feed/entities/feed.entity';
import { LetterEntity } from '../letter/entities/letter.entity';
import { MusicEntity } from '../music/entities/music.entity';
import { PopularMusicEntity } from '../music/entities/popular-music.entity';

export const AppDataSource = new DataSource({
    type: 'mariadb',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,

    entities: [
        UserEntity,
        RecordEntity,
        RecordFileEntity,
        FeedEntity,
        LetterEntity,
        MusicEntity,
        PopularMusicEntity,
    ],

    // 초반에만, 얼추되면 false 
    synchronize: true,
});