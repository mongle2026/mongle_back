import { Controller, Get, Post, Query } from '@nestjs/common';
import { MusicService } from './music.service';

@Controller('music')
export class MusicController {
  constructor(private readonly musicService: MusicService) {}

  @Get('search')
  async searchMusic(@Query('keyword') keyword: string) {
    return this.musicService.searchMusic(keyword);
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