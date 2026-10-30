import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { DeletePushTokenDto } from './dto/delete-push-token.dto';
import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';
import { UpdateNotificationSettingsDto } from './dto/update-notification-setting.dto';
import { JwtAuthGuard, OptionalAuth } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';

@Controller('notification')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async getNotifications(
    @CurrentUserId() userId: number,
    @Query() query: GetNotificationsQueryDto,
  ) {
    return this.notificationService.getNotifications({
      userId,
      type: query.type,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  // 로그인하지 않은 기기도 공지 푸시를 받을 수 있게 계정 없이 등록한다
  @Post('push-token')
  @OptionalAuth()
  async registerPushToken(
    @CurrentUserId() userId: number | undefined,
    @Body() dto: RegisterPushTokenDto,
  ) {
    return this.notificationService.registerPushToken({
      userId: userId ?? null,
      ...dto,
    });
  }

  // 로그아웃할 때 부른다. 토큰은 지우지 않고 계정에서만 떼서 공지 푸시는 계속 받는다
  @Delete('push-token')
  async detachPushToken(
    @CurrentUserId() userId: number,
    @Body() dto: DeletePushTokenDto,
  ) {
    return this.notificationService.detachPushToken(userId, dto.token);
  }

  @Get('settings')
  async getSettings(@CurrentUserId() userId: number) {
    return this.notificationService.getSettings(userId);
  }

  @Patch('settings')
  async updateSettings(
    @CurrentUserId() userId: number,
    @Body() dto: UpdateNotificationSettingsDto,
  ) {
    return this.notificationService.updateSettings(userId, dto.settings);
  }
}
