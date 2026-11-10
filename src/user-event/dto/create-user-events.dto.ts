import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CLIENT_USER_EVENT_TYPES,
  type ClientUserEventType,
  MusicListenEndReason,
} from '../enums/user-event.enum';

// 한 번에 받는 최대 개수. 앱은 모아 두었다가 이보다 적게 나눠 보낸다
export const USER_EVENT_BATCH_MAX = 50;

// 상세 체류는 6시간, 들은 위치는 1시간을 넘으면 잘못된 값으로 본다
const MAX_DURATION_MS = 6 * 60 * 60 * 1000;
const MAX_POSITION_MS = 60 * 60 * 1000;

export class ClientUserEventDto {
  @IsIn(CLIENT_USER_EVENT_TYPES)
  type!: ClientUserEventType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  feedId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_DURATION_MS)
  durationMs!: number;

  // MUSIC_LISTEN: 멈춘 지점
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_POSITION_MS)
  positionMs?: number;

  // MUSIC_LISTEN: 멈춘 이유
  @IsOptional()
  @IsIn(Object.values(MusicListenEndReason))
  endReason?: MusicListenEndReason;

  // 앱에서 일이 일어난 시각
  @IsISO8601()
  occurredAt!: string;
}

export class CreateUserEventsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(USER_EVENT_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => ClientUserEventDto)
  events!: ClientUserEventDto[];
}
