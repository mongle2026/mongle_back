import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateMusicDto } from '../music/dto/create-music.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { PostEntity } from './entities/post.entity';
import { RecordService } from '../record/record.service';

@Injectable()
export class PostService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly recordService: RecordService,
  ) { }

  async createPost(dto: CreatePostDto, files: Express.Multer.File[]) {
    const music = this.parseMusic(dto.music);

    return this.dataSource.transaction(async (manager) => {
      const record = await this.recordService.createBaseRecord(manager, {
        userId: Number(dto.userId),
        music,
        text: dto.text,
        files,
      });

      const post = manager.create(PostEntity, {
        recordId: record.id,
        visibility: dto.visibility,
      });

      const savedPost = await manager.save(PostEntity, post);

      return {
        message: '게시글이 생성되었습니다.',
        recordId: record.id,
        postId: savedPost.id,
      };
    });
  }

  private parseMusic(music: string): CreateMusicDto {
    try {
      return JSON.parse(music) as CreateMusicDto;
    } catch {
      throw new BadRequestException('music 형식이 올바르지 않습니다.');
    }
  }
}