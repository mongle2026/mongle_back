import {
  Body,
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Param,
  Query,
  Header,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeedService } from './feed.service';
import { CreateFeedDto } from './dto/create-feed.dto';
import { UpdateFeedDto } from './dto/update-feed.dto';
import { GetFeedQueryDto } from './dto/get-feed-query.dto';
import { FeedCommentService } from '../feed-comment/feed-comment.service';
import { CreateFeedCommentDto } from '../feed-comment/dto/create-feed-comment.dto';

@Controller('feed')
export class FeedController {
  constructor(
    private readonly feedService: FeedService,
    private readonly feedCommentService: FeedCommentService,
    private readonly configService: ConfigService,
  ) { }

  @Post()
  async createFeed(
    @Body() dto: CreateFeedDto,
  ) {
    return this.feedService.createFeed(dto);
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

  @Get('share/:feedId')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getFeedSharePage(
    @Param('feedId') feedId: string,
  ) {
    const meta = await this.feedService.getFeedShareMeta(
      Number(feedId),
    );

    return this.createFeedShareHtml(feedId, meta);
  }

  @Get(':feedId')
  async getFeedDetail(
    @Param('feedId') feedId: string,
    @Query('userId') userId: string,
  ) {
    return this.feedService.getFeedDetail(Number(feedId), Number(userId));
  }

  @Patch(':feedId')
  async updateFeed(
    @Param('feedId') feedId: string,
    @Query('userId') userId: string,
    @Body() dto: UpdateFeedDto,
  ) {
    return this.feedService.updateFeed(
      Number(feedId),
      Number(userId),
      dto,
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

  private createFeedShareHtml(
    feedId: string,
    meta: {
      title: string;
      description: string;
      imageUrl: string | null;
      siteName: string;
    },
  ) {
    const title = this.escapeHtml(meta.title);
    const description = this.escapeHtml(meta.description);
    const siteName = this.escapeHtml(meta.siteName);
    const imageUrl = meta.imageUrl
      ? this.escapeHtml(meta.imageUrl)
      : null;

    // 앱 미설치 시 스토어 링크는 출시 전까지 비어있을 수 있으므로,
    // 값이 없으면 딥링크 실패 후에도 이 웹페이지에 그대로 머무른다.
    const appScheme =
      this.configService.get<string>('APP_SCHEME') ?? 'mongle';
    const iosStoreUrl =
      this.configService.get<string>('IOS_APP_STORE_URL') ?? '';
    const androidStoreUrl =
      this.configService.get<string>('ANDROID_PLAY_STORE_URL') ?? '';
    const deepLink = `${appScheme}://share?feedId=${encodeURIComponent(feedId)}`;

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:site_name" content="${siteName}">
${imageUrl ? `<meta property="og:image" content="${imageUrl}">` : ''}
<title>${title}</title>
</head>
<body>
<h1>${title}</h1>
<p>${description}</p>
<script>
(function () {
  var deepLink = ${JSON.stringify(deepLink)};
  var iosStoreUrl = ${JSON.stringify(iosStoreUrl)};
  var androidStoreUrl = ${JSON.stringify(androidStoreUrl)};

  var isAndroid = /Android/i.test(navigator.userAgent);
  var isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (!isAndroid && !isIOS) {
    return;
  }

  var storeUrl = isAndroid ? androidStoreUrl : iosStoreUrl;

  var fallbackTimer = setTimeout(function () {
    if (storeUrl) {
      window.location.href = storeUrl;
    }
  }, 1500);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearTimeout(fallbackTimer);
    }
  });

  window.location.href = deepLink;
})();
</script>
</body>
</html>`;
  }

  private escapeHtml(value: string) {
    const characters: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };

    return value.replace(
      /[&<>"']/g,
      character => characters[character],
    );
  }
}