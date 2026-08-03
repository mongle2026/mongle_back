import {
  Body,
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Param,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FeedService } from './feed.service';
import { CreateFeedDto } from './dto/create-feed.dto';
import { UpdateFeedDto } from './dto/update-feed.dto';
import { GetFeedQueryDto } from './dto/get-feed-query.dto';
import { FeedCommentService } from '../feed-comment/feed-comment.service';
import { CreateFeedCommentDto } from '../feed-comment/dto/create-feed-comment.dto';
import 'multer';

@Controller('feed')
export class FeedController {
  constructor(
    private readonly feedService: FeedService,
    private readonly feedCommentService: FeedCommentService,
  ) { }

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async createFeed(
    @Body() dto: CreateFeedDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.feedService.createFeed(dto, files ?? []);
  }

  @Get()
  async getFeeds(@Query() query: GetFeedQueryDto) {
    return this.feedService.getFeeds({
      userId: query.userId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get('following')
  async getFollowingFeeds(@Query() query: GetFeedQueryDto) {
    return this.feedService.getFollowingFeeds({
      userId: query.userId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get('bookmark/me')
  async getMyBookmarkedFeeds(@Query('userId') userId: string) {
    return this.feedService.getMyBookmarkedFeeds(Number(userId));
  }

  @Get(':feedId')
  async getFeedDetail(
    @Param('feedId') feedId: string,
    @Query('userId') userId: string,
  ) {
    return this.feedService.getFeedDetail(Number(feedId), Number(userId));
  }

  @Patch(':feedId')
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async updateFeed(
    @Param('feedId') feedId: string,
    @Query('userId') userId: string,
    @Body() dto: UpdateFeedDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.feedService.updateFeed(
      Number(feedId),
      Number(userId),
      dto,
      files ?? [],
    );
  }

  @Delete(':feedId')
  async deleteFeed(
    @Param('feedId') feedId: string,
    @Query('userId') userId: string,
  ) {
    return this.feedService.deleteFeed(Number(feedId), Number(userId));
  }

  @Post(':feedId/like')
  async likeFeed(
    @Param('feedId') feedId: string,
    @Query('userId') userId: string,
  ) {
    return this.feedService.likeFeed(Number(feedId), Number(userId));
  }

  @Delete(':feedId/like')
  async unlikeFeed(
    @Param('feedId') feedId: string,
    @Query('userId') userId: string,
  ) {
    return this.feedService.unlikeFeed(Number(feedId), Number(userId));
  }

  @Post(':feedId/bookmark')
  async bookmarkFeed(
    @Param('feedId') feedId: string,
    @Query('userId') userId: string,
  ) {
    return this.feedService.bookmarkFeed(Number(feedId), Number(userId));
  }

  @Delete(':feedId/bookmark')
  async unbookmarkFeed(
    @Param('feedId') feedId: string,
    @Query('userId') userId: string,
  ) {
    return this.feedService.unbookmarkFeed(Number(feedId), Number(userId));
  }

  @Post(':feedId/comments')
  async createComment(
    @Param('feedId') feedId: string,
    @Query('userId') userId: string,
    @Body() dto: CreateFeedCommentDto,
  ) {
    return this.feedCommentService.createComment(
      Number(feedId),
      Number(userId),
      dto,
    );
  }

  @Get(':feedId/comments')
  async getComments(
    @Param('feedId') feedId: string,
    @Query('userId') userId: string,
  ) {
    return this.feedCommentService.getComments(Number(feedId), Number(userId));
  }

  @Delete(':feedId/comments/:commentId')
  async deleteComment(
    @Param('feedId') feedId: string,
    @Param('commentId') commentId: string,
    @Query('userId') userId: string,
  ) {
    return this.feedCommentService.deleteComment(
      Number(feedId),
      Number(commentId),
      Number(userId),
    );
  }
}