import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, Min } from 'class-validator';
import { NotificationSettingKey } from '../enums/notification.enum';

export class UpdateNotificationSettingDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;

  @IsEnum(NotificationSettingKey)
  key!: NotificationSettingKey;

  @IsBoolean()
  enabled!: boolean;
}
