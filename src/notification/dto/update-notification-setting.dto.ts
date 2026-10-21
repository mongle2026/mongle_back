import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { NotificationSettingKey } from '../enums/notification.enum';

export class UpdateNotificationSettingDto {
  @IsEnum(NotificationSettingKey)
  key!: NotificationSettingKey;

  @IsBoolean()
  enabled!: boolean;
}

// 전체 알림 토글처럼 여러 설정을 한 번에 바꿀 수 있게 목록으로 받는다
export class UpdateNotificationSettingsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(Object.values(NotificationSettingKey).length)
  @ValidateNested({ each: true })
  @Type(() => UpdateNotificationSettingDto)
  settings!: UpdateNotificationSettingDto[];
}
