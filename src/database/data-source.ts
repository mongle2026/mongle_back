// src/database/data-source.ts

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { RecordEntity } from 'src/record/entities/record.entity';
import { RecordFileEntity } from 'src/record/entities/record-file.entity';
import { FeedEntity } from 'src/feed/entities/feed.entity';
import { LetterEntity } from 'src/letter/entities/letter.entity';
import { MusicEntity } from 'src/music/entities/music.entity';
import { PopularMusicEntity } from 'src/music/entities/popular-music.entity';

export const AppDataSource = new DataSource({
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
    ],

    // 초반에만, 얼추되면 false 
    synchronize: true,
});