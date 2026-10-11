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
import { UpdateNotificationSettingDto } from './dto/update-notification-setting.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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

  @Post('push-token')
  async registerPushToken(
    @CurrentUserId() userId: number,
    @Body() dto: RegisterPushTokenDto,
  ) {
    return this.notificationService.registerPushToken({ userId, ...dto });
  }

  @Delete('push-token')
  async deletePushToken(
    @CurrentUserId() userId: number,
    @Body() dto: DeletePushTokenDto,
  ) {
    return this.notificationService.deletePushToken(userId, dto.token);
  }

  @Get('settings')
  async getSettings(@CurrentUserId() userId: number) {
    return this.notificationService.getSettings(userId);
  }

  @Patch('settings')
  async updateSetting(
    @CurrentUserId() userId: number,
    @Body() dto: UpdateNotificationSettingDto,
  ) {
    return this.notificationService.updateSetting({ userId, ...dto });
  }
}
