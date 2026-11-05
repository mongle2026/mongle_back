import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AppealService } from './appeal.service';
import { CreateAppealDto } from './dto/create-appeal.dto';
import { AllowRestricted, JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUserId } from '../../auth/current-user-id.decorator';

// 이용 제한된 회원이 제재 화면에서 부르는 API 라서 제한 중에도 막지 않는다
@Controller('appeal')
@UseGuards(JwtAuthGuard)
@AllowRestricted()
export class AppealController {
  constructor(private readonly appealService: AppealService) {}

  // 응답: { appealStatus: AppealStatus, isAlreadyAppealed: boolean }
  @Post()
  async create(
    @CurrentUserId() currentUserId: number,
    @Body() dto: CreateAppealDto,
  ) {
    return await this.appealService.create(currentUserId, dto);
  }

  // 지금 이용 제한 상태. 응답: { isRestricted: false } 또는 { isRestricted: true, reason, restrictedUntil, appealStatus }
  @Get('restriction')
  async getRestriction(@CurrentUserId() currentUserId: number) {
    return await this.appealService.getRestriction(currentUserId);
  }
}
