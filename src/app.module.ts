import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RecordModule } from './record/record.module';
import { PostModule } from './post/post.module';
import { LetterModule } from './letter/letter.module';

import { RecordEntity } from './record/entities/record.entity';
import { RecordFileEntity } from './record/entities/record-file.entity';
import { PostEntity } from './post/entities/post.entity';
import { LetterEntity } from './letter/entities/letter.entity';
import { MusicModule } from './music/music.module';
import { MusicEntity } from './music/entities/music.entity';
import { UserModule } from './user/user.module';
import { UserEntity } from './user/entities/user.entity';

@Module({
  imports: [
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
        PostEntity,
        LetterEntity,
        MusicEntity,
      ],

      // 초반에만, 얼추되면 false 
      synchronize: true,
    }),

    UserModule,
    RecordModule,
    PostModule,
    LetterModule,
    MusicModule,
    UserModule,
  ],
})
export class AppModule {}