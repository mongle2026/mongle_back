import {
  Body,
  Controller,
  Post,
  Get,
  Param,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FeedService } from './feed.service';
import { CreateFeedDto } from './dto/create-feed.dto';
import 'multer';
import type { Response } from 'express';

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
    @Body() dto: CreateFeedDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    // console.log('dto:', dto);
    // console.log('files length:', files?.length);
    // console.log('files:', files);
    // console.log('first file buffer exists:', !!files?.[0]?.buffer);
    return this.feedService.createFeed(dto, files ?? []);
  }

  @Get()
  async getFeeds() {
    return this.feedService.getFeeds();
  }

  // 사진 업로드 확인 용 
  // 오디오도 이걸로 확인 가능할듯 
  // @Get('files/:fileId')
  // async getRecordFile(
  //   @Param('fileId') fileId: string,
  //   @Res() res: Response,
  // ) {
  //   const file = await this.feedService.findRecordFileById(Number(fileId));

  //   res.setHeader('Content-Type', file.mimeType);

  //   return res.send(file.fileData);
  // }
}