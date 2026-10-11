import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { StampService } from './stamp.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';

@Controller('stamp')
@UseGuards(JwtAuthGuard)
export class StampController {
  constructor(private readonly stampService: StampService) {}

  @Get()
  async getStampCollection(@CurrentUserId() userId: number) {
    return this.stampService.getStampCollection({
      userId,
    });
  }

  @Get(':code')
  async getStampDetail(
    @Param('code') code: string,
    @CurrentUserId() userId: number,
  ) {
    return this.stampService.getStampDetail({
      userId,
      code,
    });
  }
}
