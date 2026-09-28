import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

// all: 전체(기본) / following: 내가 팔로우한 사람 글만
export const BOOKMARK_FEED_FILTERS = ['all', 'following'] as const;
export type BookmarkFeedFilter = (typeof BOOKMARK_FEED_FILTERS)[number];

// latest: 최근에 북마크한 순(기본) / oldest: 오래전에 북마크한 순
export const BOOKMARK_FEED_SORTS = ['latest', 'oldest'] as const;
export type BookmarkFeedSort = (typeof BOOKMARK_FEED_SORTS)[number];

// GET /feed/bookmark/me - 보관함 북마크 목록
export class GetBookmarkFeedQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;

  // 마지막으로 받은 글의 bookmarkId
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
  @IsIn(BOOKMARK_FEED_FILTERS)
  filter?: BookmarkFeedFilter;

  @IsOptional()
  @IsIn(BOOKMARK_FEED_SORTS)
  sort?: BookmarkFeedSort;
}
