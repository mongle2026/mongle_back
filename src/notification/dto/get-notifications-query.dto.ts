import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { NotificationType } from '../enums/notification.enum';

export class GetNotificationsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;

  // 없으면 전체
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  cursor?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
