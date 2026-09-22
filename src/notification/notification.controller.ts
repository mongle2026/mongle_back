import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { DeletePushTokenDto } from './dto/delete-push-token.dto';
import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';
import { UpdateNotificationSettingDto } from './dto/update-notification-setting.dto';

@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async getNotifications(@Query() query: GetNotificationsQueryDto) {
    return this.notificationService.getNotifications({
      userId: query.userId,
      type: query.type,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Post('push-token')
  async registerPushToken(@Body() dto: RegisterPushTokenDto) {
    return this.notificationService.registerPushToken(dto);
  }

  @Delete('push-token')
  async deletePushToken(@Body() dto: DeletePushTokenDto) {
    return this.notificationService.deletePushToken(dto.token);
  }

  @Get('settings')
  async getSettings(@Query('userId', ParseIntPipe) userId: number) {
    return this.notificationService.getSettings(userId);
  }

  @Patch('settings')
  async updateSetting(@Body() dto: UpdateNotificationSettingDto) {
    return this.notificationService.updateSetting(dto);
  }
}
