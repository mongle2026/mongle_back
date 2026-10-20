import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// GET /follow/me/followings, /follow/me/followers - 프로필 팔로우 / 팔로워 목록
export class GetFollowListQueryDto {
  // 마지막으로 받은 사람의 followId
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
