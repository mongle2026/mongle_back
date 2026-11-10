import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { CreateUserEventsDto } from './dto/create-user-events.dto';
import { UserEventService } from './user-event.service';

@Controller('events')
@UseGuards(JwtAuthGuard)
export class UserEventController {
  constructor(private readonly userEventService: UserEventService) { }

  // 앱이 모아 둔 행동 기록(피드 상세 체류 · 음악 들은 시간)을 한 번에 보낸다. 최대 50개
  @Post()
  @HttpCode(200)
  async createEvents(
    @CurrentUserId() userId: number,
    @Body() dto: CreateUserEventsDto,
  ) {
    return this.userEventService.recordClientEvents(userId, dto.events);
  }
}
