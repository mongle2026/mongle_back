import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, Min } from 'class-validator';

// PATCH /feed/me/profile - 프로필 게시글 편집에서 바꾼 글만 보낸다
export class UpdateProfileFeedsDto {
  // 프로필에 다시 보이게 할 글
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  showFeedIds?: number[];

  // 프로필에서 뺄 글
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  hideFeedIds?: number[];
}
