import {
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PostService } from './post.service';
import { CreatePostDto } from './dto/create-post.dto';
import 'multer';

@Controller('post')
export class PostController {
  constructor(private readonly postService: PostService) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async createPost(
    @Body() dto: CreatePostDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.postService.createPost(dto, files ?? []);
  }
}