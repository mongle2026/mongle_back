import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// 추천 피드 (GET /feed/recommended). cursor 는 응답의 nextCursor 를 그대로 넘기는 문자열이다 (feedId 아님)
export class GetRecommendedFeedQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
