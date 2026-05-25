import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostController } from './post.controller';
import { PostService } from './post.service';
import { PostEntity } from './entities/post.entity';
import { RecordModule } from '../record/record.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PostEntity]),
    RecordModule,
  ],
  controllers: [PostController],
  providers: [PostService],
})
export class PostModule {}