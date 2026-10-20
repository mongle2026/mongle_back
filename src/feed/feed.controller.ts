import {
  Body,
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FeedService } from './feed.service';
import { CreateFeedDto } from './dto/create-feed.dto';
import { UpdateFeedDto } from './dto/update-feed.dto';
import { GetFeedQueryDto } from './dto/get-feed-query.dto';
import {
  GetMyFeedGroupQueryDto,
  GetMyFeedQueryDto,
} from './dto/get-my-feed-query.dto';
import { GetBookmarkFeedQueryDto } from './dto/get-bookmark-feed-query.dto';
import { UpdateProfileFeedsDto } from './dto/update-profile-feeds.dto';
import { FeedCommentService } from '../feed-comment/feed-comment.service';
import { CreateFeedCommentDto } from '../feed-comment/dto/create-feed-comment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';

// 공유 웹페이지(GET /feed/share/:feedId)는 로그인 없이 열려야 해서 FeedShareController 에 따로 둔다
@Controller('feed')
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(
    private readonly feedService: FeedService,
    private readonly feedCommentService: FeedCommentService,
  ) { }

  @Post()
  async createFeed(
    @CurrentUserId() userId: number,
    @Body() dto: CreateFeedDto,
  ) {
    return this.feedService.createFeed(userId, dto);
  }

  @Get()
  async getFeeds(
    @CurrentUserId() userId: number,
    @Query() query: GetFeedQueryDto,
  ) {
    return this.feedService.getFeeds({
      userId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get('following')
  async getFollowingFeeds(
    @CurrentUserId() userId: number,
    @Query() query: GetFeedQueryDto,
  ) {
    return this.feedService.getFollowingFeeds({
      userId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  // 보관함 - 내 기록. ':feedId' 보다 위에 있어야 'me' 가 feedId 로 잡히지 않는다
  @Get('me')
  async getMyFeeds(
    @CurrentUserId() userId: number,
    @Query() query: GetMyFeedQueryDto,
  ) {
    return this.feedService.getMyFeeds({
      userId,
      cursor: query.cursor,
      limit: query.limit,
      genre: query.genre,
      month: query.month,
      sort: query.sort,
      keyword: query.keyword,
    });
  }

  @Get('me/genres')
  async getMyFeedGenres(
    @CurrentUserId() userId: number,
    @Query() query: GetMyFeedGroupQueryDto,
  ) {
    return this.feedService.getMyFeedGenres(userId, query.limit, query.coverSeed);
  }

  @Get('me/months')
  async getMyFeedMonths(
    @CurrentUserId() userId: number,
    @Query() query: GetMyFeedGroupQueryDto,
  ) {
    return this.feedService.getMyFeedMonths(userId, query.limit, query.coverSeed, query.keyword);
  }

  // 프로필 게시글 편집 저장. 바꾼 글만 보낸다
  @Patch('me/profile')
  async updateProfileFeeds(
    @CurrentUserId() userId: number,
    @Body() dto: UpdateProfileFeedsDto,
  ) {
    return this.feedService.updateProfileFeeds(userId, dto);
  }

  // 프로필 노래 커버 그리드. publicId 는 프로필 주인 (내 프로필이면 내 publicId)
  @Get('profile/:publicId')
  async getProfileFeeds(
    @Param('publicId', ParseUUIDPipe) publicId: string,
    @CurrentUserId() userId: number,
    @Query() query: GetFeedQueryDto,
  ) {
    return this.feedService.getProfileFeeds({
      viewerId: userId,
      ownerPublicId: publicId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  // 보관함 - 북마크
  @Get('bookmark/me')
  async getMyBookmarkedFeeds(
    @CurrentUserId() userId: number,
    @Query() query: GetBookmarkFeedQueryDto,
  ) {
    return this.feedService.getMyBookmarkedFeeds({
      userId,
      cursor: query.cursor,
      limit: query.limit,
      filter: query.filter,
      sort: query.sort,
    });
  }

  @Get(':feedId')
  async getFeedDetail(
    @Param('feedId') feedId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.feedService.getFeedDetail(Number(feedId), userId);
  }

  @Patch(':feedId')
  async updateFeed(
    @Param('feedId') feedId: string,
    @CurrentUserId() userId: number,
    @Body() dto: UpdateFeedDto,
  ) {
    return this.feedService.updateFeed(
      Number(feedId),
      userId,
      dto,
    );
  }

  @Delete(':feedId')
  async deleteFeed(
    @Param('feedId') feedId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.feedService.deleteFeed(Number(feedId), userId);
  }

  @Post(':feedId/like')
  async likeFeed(
    @Param('feedId') feedId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.feedService.likeFeed(Number(feedId), userId);
  }

  @Delete(':feedId/like')
  async unlikeFeed(
    @Param('feedId') feedId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.feedService.unlikeFeed(Number(feedId), userId);
  }

  @Post(':feedId/bookmark')
  async bookmarkFeed(
    @Param('feedId') feedId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.feedService.bookmarkFeed(Number(feedId), userId);
  }

  @Delete(':feedId/bookmark')
  async unbookmarkFeed(
    @Param('feedId') feedId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.feedService.unbookmarkFeed(Number(feedId), userId);
  }

  @Post(':feedId/comments')
  async createComment(
    @Param('feedId') feedId: string,
    @CurrentUserId() userId: number,
    @Body() dto: CreateFeedCommentDto,
  ) {
    return this.feedCommentService.createComment(
      Number(feedId),
      userId,
      dto,
    );
  }

  @Get(':feedId/comments')
  async getComments(
    @Param('feedId') feedId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.feedCommentService.getComments(Number(feedId), userId);
  }

  @Delete(':feedId/comments/:commentId')
  async deleteComment(
    @Param('feedId') feedId: string,
    @Param('commentId') commentId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.feedCommentService.deleteComment(
      Number(feedId),
      Number(commentId),
      userId,
    );
  }
}
