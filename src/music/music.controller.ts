import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  MusicService,
  type MusicSearchResponse,
} from './music.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { RecommendationService } from '../recommendation/recommendation.service';

@Controller('music')
@UseGuards(JwtAuthGuard)
export class MusicController {
  constructor(
    private readonly musicService: MusicService,
    private readonly recommendationService: RecommendationService,
  ) { }

  @Get('search')
  searchMusic(
    @Query('keyword') keyword: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<MusicSearchResponse> {
    return this.musicService.searchMusic(keyword, page, limit);
  }

  @Get('popular')
  findPopularMusics() {
    return this.musicService.findPopularMusics();
  }

  // 미리듣기를 새로 틀 때 앱이 부른다 (피드 · 보관함 · 편지. 글쓰기 화면은 빼고).
  // 추천 피드의 취향 신호("재생해 본 음악")로 쌓인다. musicId 는 서버 음악 id (응답의 music.musicId)
  @Post(':musicId/play')
  recordPlay(
    @Param('musicId', ParseIntPipe) musicId: number,
    @CurrentUserId() userId: number,
  ) {
    return this.recommendationService.recordMusicPlay(userId, musicId);
  }

  @Post('popular/refresh')
  refreshPopularMusics() {
    return this.musicService.refreshPopularMusics();
  }
}