import {
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FeedService } from './feed.service';
import { CreateFeedDto } from './dto/create-feed.dto';
import 'multer';

@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) { }

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async createPost(
    // @Body() dto: CreateFeedDto,
    @Body() dto: any,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    console.log('body:', dto);
    console.log('music:', dto.music);
    console.log('music type:', typeof dto.music);
    
    return this.feedService.createFeed(dto, files ?? []);
  }
}