import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AppealService } from './appeal.service';
import { SanctionService } from '../sanction/sanction.service';
import { CreateAppealDto } from './dto/create-appeal.dto';
import { AllowRestricted, JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUserId } from '../../auth/current-user-id.decorator';

// 이용 제한된 회원이 제재 화면에서 부르는 API 라서 제한 중에도 막지 않는다
@Controller('appeal')
@UseGuards(JwtAuthGuard)
@AllowRestricted()
export class AppealController {
  constructor(
    private readonly appealService: AppealService,
    private readonly sanctionService: SanctionService,
  ) {}

  // 응답: { appealStatus: AppealStatus, isAlreadyAppealed: boolean }
  @Post()
  async create(
    @CurrentUserId() currentUserId: number,
    @Body() dto: CreateAppealDto,
  ) {
    return await this.appealService.create(currentUserId, dto);
  }

  /**
   * @deprecated GET /sanction/restriction 으로 옮겼다. 이 경로를 부르는 이전 버전 앱을 위해 남겨 둔다
   */
  @Get('restriction')
  async getRestriction(@CurrentUserId() currentUserId: number) {
    return await this.sanctionService.getRestriction(currentUserId);
  }
}
