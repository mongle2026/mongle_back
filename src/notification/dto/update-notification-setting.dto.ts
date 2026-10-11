import { IsBoolean, IsEnum } from 'class-validator';
import { NotificationSettingKey } from '../enums/notification.enum';

export class UpdateNotificationSettingDto {
  @IsEnum(NotificationSettingKey)
  key!: NotificationSettingKey;

  @IsBoolean()
  enabled!: boolean;
}
