import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  MusicService,
  type MusicSearchResponse,
} from './music.service';

@Controller('music')
export class MusicController {
  constructor(private readonly musicService: MusicService) { }

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

  @Post('popular/refresh')
  refreshPopularMusics() {
    return this.musicService.refreshPopularMusics();
  }
}