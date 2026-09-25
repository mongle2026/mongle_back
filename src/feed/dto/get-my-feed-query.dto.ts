import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// latest: 최신순(기본) / oldest: 오래된순 / music: 노래 제목순 (한글 → 영문 → 숫자·기호)
export const MY_FEED_SORTS = ['latest', 'oldest', 'music'] as const;
export type MyFeedSort = (typeof MY_FEED_SORTS)[number];

// GET /feed/me - 보관함 내 기록 목록 (genre / month 로 좁힐 수 있음)
export class GetMyFeedQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;

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

  @IsOptional()
  @IsString()
  @MaxLength(100)
  genre?: string;

  // 한국 시간 기준 'YYYY-MM'
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month 형식은 YYYY-MM 입니다.' })
  month?: string;

  @IsOptional()
  @IsIn(MY_FEED_SORTS)
  sort?: MyFeedSort;
}

// GET /feed/me/genres, GET /feed/me/months
export class GetMyFeedGroupQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  // 앱 실행마다 프론트가 만드는 값. 같으면 장르·월 카드 커버가 같게 나온다
  @IsOptional()
  @IsString()
  @MaxLength(32)
  coverSeed?: string;
}
