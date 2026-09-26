import { createHash } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Brackets, DataSource, In } from 'typeorm';
import { CreateMusicDto } from '../music/dto/create-music.dto';
import { CreateFeedDto } from './dto/create-feed.dto';
import { FeedEntity } from './entities/feed.entity';
import { RecordService } from '../record/record.service';
import { RecordFileEntity } from '../record/entities/record-file.entity';
import { FeedLikeEntity } from '../like/entities/feed-like.entity';
import { BookmarkEntity } from '../bookmark/entities/bookmark.entity';
import { RecordEntity } from '../record/entities/record.entity';
import { UpdateFeedDto } from './dto/update-feed.dto';
import { MyFeedSort } from './dto/get-my-feed-query.dto';
import { Visibility } from './enums/visibility.enum';
import { FollowService } from '../follow/follow.service';
import { R2Service } from '../storage/r2.service';

// 보관함 장르별 기록에서 빼는 장르. 한국/영어 스토어프런트 표기를 모두 둔다
const EXCLUDED_ARCHIVE_GENRES = ['음악', 'Music'];

// 보관함 제목순: 노래 제목 첫 글자로 묶어 한글 → 영문 → 숫자 → 기호·기타 언어 순으로 둔다.
// 묶음 안에서는 DB collation 순서 (가~하, 대소문자 구분 없이 A~Z)
const TITLE_GROUP_SQL = `
  CASE
    WHEN music.music_title REGEXP '^[가-힣ㄱ-ㅎㅏ-ㅣ]' THEN 0
    WHEN music.music_title REGEXP '^[A-Za-z]' THEN 1
    WHEN music.music_title REGEXP '^[0-9]' THEN 2
    ELSE 3
  END
`;

@Injectable()
export class FeedService {
  // includeMeInAllFeed       GET /feed           내 글 포함
  // includeMeInFollowingFeed GET /feed/following 내 글 미포함
  private readonly includeMeInAllFeed = true;
  private readonly includeMeInFollowingFeed = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly recordService: RecordService,
    private readonly followService: FollowService,
    private readonly r2Service: R2Service,
  ) { }

  async createFeed(dto: CreateFeedDto) {
    const music = this.parseMusic(dto.music);

    return this.dataSource.transaction(async manager => {
      const record = await this.recordService.createBaseRecord(manager, {
        userId: Number(dto.userId),
        music,
        text: dto.text,
        font: dto.font,
      });

      /*
       * 업로드가 끝난 파일을 같은 트랜잭션에서 붙입니다.
       * 첨부가 실패하면 레코드도 함께 롤백되어 반쪽짜리 글이 남지 않습니다.
       */
      await this.recordService.attachFiles(manager, {
        recordId: record.id,
        userId: Number(dto.userId),
        files: dto.files ?? [],
      });

      const feed = manager.create(FeedEntity, {
        recordId: record.id,
        visibility: dto.visibility,
      });

      const savedFeed = await manager.save(FeedEntity, feed);

      return {
        message: '게시글이 생성되었습니다.',
        recordId: record.id,
        feedId: savedFeed.id,
      };
    });
  }

  async getFeeds(params: {
    userId: number;
    cursor?: number;
    limit?: number;
  }) {
    const { userId, cursor } = params;
    const limit = params.limit ?? 20;

    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('userId가 올바르지 않습니다.');
    }

    if (cursor !== undefined && (!cursor || Number.isNaN(cursor))) {
      throw new BadRequestException('cursor 값이 올바르지 않습니다.');
    }

    if (!limit || Number.isNaN(limit)) {
      throw new BadRequestException('limit 값이 올바르지 않습니다.');
    }

    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const followingIds = await this.followService.getFollowingIds(userId);

    const queryBuilder = this.dataSource
      .getRepository(FeedEntity)
      .createQueryBuilder('feed')
      .leftJoinAndSelect('feed.record', 'record')
      .leftJoinAndSelect('record.user', 'user')
      .leftJoinAndSelect('record.music', 'music')
      .leftJoinAndSelect('record.files', 'files')

      // 좋아요 총 개수
      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(feedLike.id)')
          .from(FeedLikeEntity, 'feedLike')
          .where('feedLike.feedId = feed.id');
      }, 'likeCount')

      // 내가 좋아요 눌렀는지
      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(myLike.id)')
          .from(FeedLikeEntity, 'myLike')
          .where('myLike.feedId = feed.id')
          .andWhere('myLike.userId = :userId');
      }, 'isLikedCount')

      // 내가 북마크했는지
      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(myBookmark.id)')
          .from(BookmarkEntity, 'myBookmark')
          .where('myBookmark.feedId = feed.id')
          .andWhere('myBookmark.userId = :userId');
      }, 'isBookmarkedCount')

      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(bookmark.id)')
          .from(BookmarkEntity, 'bookmark')
          .where('bookmark.feedId = feed.id');
      }, 'bookmarkCount')

      .where(
        new Brackets(qb => {
          // 1. 전체 공개 게시물
          qb.where('feed.visibility = :publicVisibility', {
            publicVisibility: Visibility.PUBLIC,
          });

          // 2. 내 게시물
          if (this.includeMeInAllFeed) {
            qb.orWhere(
              new Brackets(selfQb => {
                selfQb
                  .where('record.userId = :userId')
                  .andWhere('feed.visibility IN (:...selfVisibilities)', {
                    selfVisibilities: [
                      Visibility.PUBLIC,
                      Visibility.FOLLOWER,
                    ],
                  });
              }),
            );
          }

          // 3. 내가 팔로우한 사용자의 팔로워 공개 게시물
          if (followingIds.length > 0) {
            qb.orWhere(
              new Brackets(followQb => {
                followQb
                  .where('feed.visibility = :followVisibility', {
                    followVisibility: Visibility.FOLLOWER,
                  })
                  .andWhere('record.userId IN (:...followingIds)', {
                    followingIds,
                  });
              }),
            );
          }
        }),
      )
      .setParameter('userId', userId)
      .orderBy('feed.id', 'DESC')
      .take(safeLimit + 1);

    if (cursor !== undefined) {
      queryBuilder.andWhere('feed.id < :cursor', { cursor });
    }

    const result = await queryBuilder.getRawAndEntities();
    const rawByFeedId = new Map<number, any>();

    result.raw.forEach(raw => {
      const feedId = Number(raw.feed_id);

      if (!rawByFeedId.has(feedId)) {
        rawByFeedId.set(feedId, raw);
      }
    });

    const feeds = result.entities.map(feed => {
      const raw = rawByFeedId.get(Number(feed.id));
      const authorId = Number(feed.record.user.id);

      return this.formatFeedResponse(feed, {
        likeCount: Number(raw?.likeCount ?? 0),
        bookmarkCount: Number(raw?.bookmarkCount ?? 0),
        isLiked: Number(raw?.isLikedCount ?? 0) > 0,
        isBookmarked: Number(raw?.isBookmarkedCount ?? 0) > 0,
        isFollowing: followingIds.includes(authorId),
      });
    });

    const hasNext = feeds.length > safeLimit;
    const items = hasNext ? feeds.slice(0, safeLimit) : feeds;
    const lastItem = items[items.length - 1];

    return {
      items,
      nextCursor: hasNext && lastItem ? lastItem.feedId : null,
      hasNext,
    };
  }

  async getFollowingFeeds(params: {
    userId: number;
    cursor?: number;
    limit?: number;
  }) {
    const { userId, cursor } = params;
    const includeMe = this.includeMeInFollowingFeed;
    const limit = params.limit ?? 20;

    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('userId가 올바르지 않습니다.');
    }

    if (cursor !== undefined && (!cursor || Number.isNaN(cursor))) {
      throw new BadRequestException('cursor 값이 올바르지 않습니다.');
    }

    if (!limit || Number.isNaN(limit)) {
      throw new BadRequestException('limit 값이 올바르지 않습니다.');
    }

    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const followingIds = await this.followService.getFollowingIds(userId);

    const authorIds = includeMe
      ? Array.from(new Set([userId, ...followingIds]))
      : followingIds;

    if (authorIds.length === 0) {
      return {
        items: [],
        nextCursor: null,
        hasNext: false,
      };
    }

    const result = await this.dataSource
      .getRepository(FeedEntity)
      .createQueryBuilder('feed')
      .leftJoinAndSelect('feed.record', 'record')
      .leftJoinAndSelect('record.user', 'user')
      .leftJoinAndSelect('record.music', 'music')
      .leftJoinAndSelect('record.files', 'files')

      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(feedLike.id)')
          .from(FeedLikeEntity, 'feedLike')
          .where('feedLike.feedId = feed.id');
      }, 'likeCount')

      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(myLike.id)')
          .from(FeedLikeEntity, 'myLike')
          .where('myLike.feedId = feed.id')
          .andWhere('myLike.userId = :userId');
      }, 'isLikedCount')

      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(myBookmark.id)')
          .from(BookmarkEntity, 'myBookmark')
          .where('myBookmark.feedId = feed.id')
          .andWhere('myBookmark.userId = :userId');
      }, 'isBookmarkedCount')

      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(bookmark.id)')
          .from(BookmarkEntity, 'bookmark')
          .where('bookmark.feedId = feed.id');
      }, 'bookmarkCount')

      .where('record.userId IN (:...authorIds)', { authorIds })
      .andWhere('feed.visibility IN (:...visibleVisibilities)', {
        visibleVisibilities: [Visibility.PUBLIC, Visibility.FOLLOWER],
      })
      .andWhere(cursor ? 'feed.id < :cursor' : '1=1', { cursor })
      .setParameter('userId', userId)
      .orderBy('feed.id', 'DESC')
      .take(safeLimit + 1)
      .getRawAndEntities();

    const rawByFeedId = new Map<number, any>();

    result.raw.forEach(raw => {
      const feedId = Number(raw.feed_id);

      if (!rawByFeedId.has(feedId)) {
        rawByFeedId.set(feedId, raw);
      }
    });

    const feeds = result.entities.map(feed => {
      const raw = rawByFeedId.get(Number(feed.id));
      const authorId = Number(feed.record.user.id);

      return this.formatFeedResponse(feed, {
        likeCount: Number(raw?.likeCount ?? 0),
        bookmarkCount: Number(raw?.bookmarkCount ?? 0),
        isLiked: Number(raw?.isLikedCount ?? 0) > 0,
        isBookmarked: Number(raw?.isBookmarkedCount ?? 0) > 0,
        isFollowing: followingIds.includes(authorId),
      });
    });

    const hasNext = feeds.length > safeLimit;
    const items = hasNext ? feeds.slice(0, safeLimit) : feeds;
    const lastItem = items[items.length - 1];

    return {
      items,
      nextCursor: hasNext && lastItem ? lastItem.feedId : null,
      hasNext,
    };
  }

  async getFeedShareMeta(feedId: number) {
    if (!Number.isInteger(feedId) || feedId < 1) {
      throw new BadRequestException('feedId가 올바르지 않습니다.');
    }

    const feed = await this.dataSource
      .getRepository(FeedEntity)
      .createQueryBuilder('feed')
      .leftJoinAndSelect('feed.record', 'record')
      .leftJoinAndSelect('record.user', 'user')
      .leftJoinAndSelect('record.music', 'music')
      .where('feed.id = :feedId', { feedId })
      .getOne();

    if (!feed) {
      throw new NotFoundException('피드를 찾을 수 없습니다.');
    }

    if (feed.visibility !== Visibility.PUBLIC) {
      return {
        title: 'mongle',
        description: '공개 범위가 제한된 기록입니다.',
        imageUrl: null,
        siteName: 'mongle',
      };
    }

    const userCode = feed.record.user.userCode?.trim();
    const nickname = feed.record.user.nickname?.trim();

    const authorLabel = userCode
      ? `@${userCode}`
      : nickname || '사용자';

    const musicTitle =
      feed.record.music?.musicTitle?.trim() ?? '';

    const musicArtist =
      feed.record.music?.musicArtist?.trim() ?? '';

    const musicText = [
      musicTitle,
      musicArtist,
    ]
      .filter(Boolean)
      .join(' - ');

    const title = musicText
      ? `[mongle] ${authorLabel}님의 기록\n${musicText}`
      : `[mongle] ${authorLabel}님의 기록`;

    const recordText =
      feed.record.text
        ?.trim()
        .replace(/\s+/g, ' ') ?? '';

    const maxDescriptionLength = 70;

    const description =
      recordText.length > maxDescriptionLength
        ? `${recordText.slice(0, maxDescriptionLength)}…`
        : recordText;

    return {
      title,
      description:
        description || '음악과 함께 남긴 기록입니다.',
      imageUrl:
        feed.record.music?.musicArtwork ?? null,
      siteName: 'mongle',
    };
  }

  async getFeedDetail(feedId: number, userId: number) {
    if (!Number.isInteger(feedId) || feedId < 1) {
      throw new BadRequestException('feedId가 올바르지 않습니다.');
    }

    if (!Number.isInteger(userId) || userId < 1) {
      throw new BadRequestException('userId가 올바르지 않습니다.');
    }

    const result = await this.dataSource
      .getRepository(FeedEntity)
      .createQueryBuilder('feed')
      .leftJoinAndSelect('feed.record', 'record')
      .leftJoinAndSelect('record.user', 'user')
      .leftJoinAndSelect('record.music', 'music')
      .leftJoinAndSelect('record.files', 'files')

      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(feedLike.id)')
          .from(FeedLikeEntity, 'feedLike')
          .where('feedLike.feedId = feed.id');
      }, 'likeCount')

      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(myLike.id)')
          .from(FeedLikeEntity, 'myLike')
          .where('myLike.feedId = feed.id')
          .andWhere('myLike.userId = :userId');
      }, 'isLikedCount')

      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(myBookmark.id)')
          .from(BookmarkEntity, 'myBookmark')
          .where('myBookmark.feedId = feed.id')
          .andWhere('myBookmark.userId = :userId');
      }, 'isBookmarkedCount')

      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(bookmark.id)')
          .from(BookmarkEntity, 'bookmark')
          .where('bookmark.feedId = feed.id');
      }, 'bookmarkCount')

      .where('feed.id = :feedId', { feedId })
      .setParameter('userId', userId)
      .getRawAndEntities();

    const feed = result.entities[0];

    if (!feed) {
      throw new NotFoundException('피드를 찾을 수 없습니다.');
    }

    const authorId = Number(feed.record.user.id);
    const isMine = authorId === userId;

    let isFollowing = false;

    if (!isMine) {
      const followingIds = await this.followService.getFollowingIds(userId);
      isFollowing = followingIds.includes(authorId);

      if (
        feed.visibility === Visibility.FOLLOWER &&
        !isFollowing
      ) {
        throw new NotFoundException('피드를 찾을 수 없습니다.');
      }
    }

    const raw = result.raw[0];

    return this.formatFeedResponse(feed, {
      likeCount: Number(raw.likeCount ?? 0),
      bookmarkCount: Number(raw.bookmarkCount ?? 0),
      isLiked: Number(raw.isLikedCount ?? 0) > 0,
      isBookmarked: Number(raw.isBookmarkedCount ?? 0) > 0,
      isFollowing,
    });
  }

  async updateFeed(
    feedId: number,
    userId: number,
    dto: UpdateFeedDto,
  ) {
    if (!feedId || Number.isNaN(feedId)) {
      throw new BadRequestException('feedId가 올바르지 않습니다.');
    }

    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('userId가 올바르지 않습니다.');
    }

    if (
      dto.visibility !== undefined &&
      !Object.values(Visibility).includes(dto.visibility)
    ) {
      throw new BadRequestException('visibility 값이 올바르지 않습니다.');
    }

    const music = dto.music ? this.parseMusic(dto.music) : undefined;
    const deleteFileIds = this.parseDeleteFileIds(dto.deleteFileIds);

    return this.dataSource.transaction(async manager => {
      const feed = await manager
        .getRepository(FeedEntity)
        .createQueryBuilder('feed')
        .leftJoinAndSelect('feed.record', 'record')
        .leftJoinAndSelect('record.files', 'files')
        .where('feed.id = :feedId', { feedId })
        .andWhere('record.userId = :userId', { userId })
        .getOne();

      if (!feed) {
        throw new NotFoundException('수정할 피드를 찾을 수 없습니다.');
      }

      let isFeedChanged = false;

      if (dto.visibility !== undefined) {
        feed.visibility = dto.visibility;
        isFeedChanged = true;
      }

      await this.recordService.updateBaseRecord(manager, feed.record, {
        text: dto.text,
        music,
        font: dto.font,
        deleteFileIds,
        touch: true,
      });

      /*
       * 삭제를 먼저 반영한 뒤에 붙여야 최대 개수 계산이 맞습니다.
       */
      await this.recordService.attachFiles(manager, {
        recordId: feed.record.id,
        userId,
        files: dto.files ?? [],
      });

      if (isFeedChanged) {
        await manager.save(FeedEntity, feed);
      }

      return {
        message: '피드가 수정되었습니다.',
        feedId: feed.id,
        recordId: feed.record.id,
      };
    });
  }

  async deleteFeed(feedId: number, userId: number) {
    if (!feedId || Number.isNaN(feedId)) {
      throw new BadRequestException('feedId가 올바르지 않습니다.');
    }

    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('userId가 올바르지 않습니다.');
    }

    return this.dataSource.transaction(async manager => {
      const feed = await manager
        .getRepository(FeedEntity)
        .createQueryBuilder('feed')
        .leftJoinAndSelect('feed.record', 'record')
        .where('feed.id = :feedId', { feedId })
        .andWhere('record.userId = :userId', { userId })
        .getOne();

      if (!feed) {
        throw new NotFoundException('삭제할 피드를 찾을 수 없습니다.');
      }

      await manager.delete(FeedLikeEntity, { feedId });
      await manager.delete(BookmarkEntity, { feedId });
      await manager.softDelete(FeedEntity, { id: feedId });

      return {
        message: '피드가 삭제되었습니다.',
        feedId,
      };
    });
  }

  async purgeDeletedFeeds(days = 30, limit = 100) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return this.dataSource.transaction(async manager => {
      const feeds = await manager
        .getRepository(FeedEntity)
        .createQueryBuilder('feed')
        .withDeleted()
        .where('feed.deletedAt IS NOT NULL')
        .andWhere('feed.deletedAt <= :cutoff', { cutoff })
        .orderBy('feed.deletedAt', 'ASC')
        .limit(limit)
        .getMany();

      if (feeds.length === 0) {
        return {
          message: '물리 삭제할 피드가 없습니다.',
          deletedFeedCount: 0,
          deletedRecordFileCount: 0,
          deletedRecordCount: 0,
        };
      }

      const feedIds = feeds.map(feed => Number(feed.id));
      const recordIds = [
        ...new Set(feeds.map(feed => Number(feed.recordId))),
      ];

      await manager.delete(FeedLikeEntity, {
        feedId: In(feedIds),
      });

      await manager.delete(BookmarkEntity, {
        feedId: In(feedIds),
      });

      const feedDeleteResult = await manager.delete(FeedEntity, {
        id: In(feedIds),
      });

      const recordsToDelete = await manager.find(RecordEntity, {
        where: { id: In(recordIds) },
      });

      const userIdByRecordId = new Map(
        recordsToDelete.map((record) => [
          Number(record.id),
          Number(record.userId),
        ]),
      );

      const filesToDelete = await manager.find(RecordFileEntity, {
        where: { recordId: In(recordIds) },
      });

      const recordFileDeleteResult = await manager.delete(RecordFileEntity, {
        recordId: In(recordIds),
      });

      const recordDeleteResult = await manager.delete(RecordEntity, {
        id: In(recordIds),
      });

      /*
       * R2 삭제는 크론에 맡깁니다.
       * 여기서 바로 지우면 이 트랜잭션이 롤백됐을 때 객체만 사라집니다.
       */
      await this.recordService.detachFiles(
        manager,
        filesToDelete.map((file) => ({
          userId: userIdByRecordId.get(Number(file.recordId)) ?? 0,
          fileKey: file.fileKey,
          mimeType: file.mimeType,
        })),
      );

      return {
        message: '삭제 보관 기간이 지난 피드가 물리 삭제되었습니다.',
        deletedFeedCount: feedDeleteResult.affected ?? 0,
        deletedRecordFileCount: recordFileDeleteResult.affected ?? 0,
        deletedRecordCount: recordDeleteResult.affected ?? 0,
      };
    });
  }

  async likeFeed(feedId: number, userId: number) {
    return this.dataSource.transaction(async manager => {
      const feed = await manager.findOne(FeedEntity, {
        where: { id: feedId },
      });

      if (!feed) {
        throw new NotFoundException('피드를 찾을 수 없습니다.');
      }

      const existingLike = await manager.findOne(FeedLikeEntity, {
        where: {
          feedId,
          userId,
        },
      });

      if (existingLike) {
        return {
          message: '이미 좋아요한 피드입니다.',
          isLiked: true,
        };
      }

      const like = manager.create(FeedLikeEntity, {
        feedId,
        userId,
      });

      await manager.save(FeedLikeEntity, like);

      return {
        message: '좋아요가 추가되었습니다.',
        isLiked: true,
      };
    });
  }

  async unlikeFeed(feedId: number, userId: number) {
    return this.dataSource.transaction(async manager => {
      const feed = await manager.findOne(FeedEntity, {
        where: { id: feedId },
      });

      if (!feed) {
        throw new NotFoundException('피드를 찾을 수 없습니다.');
      }

      const existingLike = await manager.findOne(FeedLikeEntity, {
        where: {
          feedId,
          userId,
        },
      });

      if (!existingLike) {
        return {
          message: '이미 좋아요가 취소된 피드입니다.',
          isLiked: false,
        };
      }

      await manager.remove(FeedLikeEntity, existingLike);

      return {
        message: '좋아요가 취소되었습니다.',
        isLiked: false,
      };
    });
  }

  async bookmarkFeed(feedId: number, userId: number) {
    return this.dataSource.transaction(async manager => {
      const feed = await manager.findOne(FeedEntity, {
        where: { id: feedId },
      });

      if (!feed) {
        throw new NotFoundException('피드를 찾을 수 없습니다.');
      }

      const existingBookmark = await manager.findOne(BookmarkEntity, {
        where: {
          feedId,
          userId,
        },
      });

      if (existingBookmark) {
        return {
          message: '이미 북마크한 피드입니다.',
          isBookmarked: true,
        };
      }

      const bookmark = manager.create(BookmarkEntity, {
        feedId,
        userId,
      });

      await manager.save(BookmarkEntity, bookmark);

      return {
        message: '북마크가 추가되었습니다.',
        isBookmarked: true,
      };
    });
  }

  async unbookmarkFeed(feedId: number, userId: number) {
    return this.dataSource.transaction(async manager => {
      const feed = await manager.findOne(FeedEntity, {
        where: { id: feedId },
      });

      if (!feed) {
        throw new NotFoundException('피드를 찾을 수 없습니다.');
      }

      const existingBookmark = await manager.findOne(BookmarkEntity, {
        where: {
          feedId,
          userId,
        },
      });

      if (!existingBookmark) {
        return {
          message: '이미 북마크가 취소된 피드입니다.',
          isBookmarked: false,
        };
      }

      await manager.remove(BookmarkEntity, existingBookmark);

      return {
        message: '북마크가 취소되었습니다.',
        isBookmarked: false,
      };
    });
  }

  /*
   * 보관함 - 내 기록 목록 (최근 기록, 장르 상세, 월 상세 공용)
   * 내 글이므로 공개 범위와 상관없이 모두 보여줍니다.
   * genre: 음악 장르 배열에 포함된 글만 / month: 한국 시간 기준 'YYYY-MM'
   * sort: latest(기본) / oldest 는 feedId 커서, title 은 제목이 겹칠 수 있어 offset 커서를 씁니다.
   * 프론트는 nextCursor 를 그대로 다시 보내면 됩니다.
   */
  async getMyFeeds(params: {
    userId: number;
    cursor?: number;
    limit?: number;
    genre?: string;
    month?: string;
    sort?: MyFeedSort;
  }) {
    const { userId, cursor, genre, month, sort = 'latest' } = params;
    const safeLimit = Math.min(Math.max(params.limit ?? 20, 1), 50);
    const offset = sort === 'title' ? cursor ?? 0 : 0;

    // 1) 정렬·페이지에 해당하는 feedId 만 먼저 고른다
    const pageQuery = this.dataSource
      .getRepository(FeedEntity)
      .createQueryBuilder('feed')
      .innerJoin('feed.record', 'record')
      .leftJoin('record.music', 'music')
      .select('feed.id', 'feedId')
      .where('record.userId = :userId', { userId })
      .limit(safeLimit + 1);

    if (genre !== undefined) {
      pageQuery.andWhere('JSON_CONTAINS(music.musicGenre, JSON_QUOTE(:genre))', { genre });
    }

    if (month !== undefined) {
      const { start, end } = this.getKstMonthRange(month);

      pageQuery
        .andWhere('record.createdAt >= :monthStart', { monthStart: start })
        .andWhere('record.createdAt < :monthEnd', { monthEnd: end });
    }

    if (sort === 'title') {
      pageQuery
        .addSelect(TITLE_GROUP_SQL, 'titleGroup')
        .orderBy('titleGroup', 'ASC')
        .addOrderBy('music.musicTitle', 'ASC')
        .addOrderBy('feed.id', 'DESC')
        .offset(offset);
    } else {
      const isOldest = sort === 'oldest';

      pageQuery.orderBy('feed.id', isOldest ? 'ASC' : 'DESC');

      if (cursor !== undefined) {
        pageQuery.andWhere(isOldest ? 'feed.id > :cursor' : 'feed.id < :cursor', { cursor });
      }
    }

    const pageRows: Array<{ feedId: number | string }> = await pageQuery.getRawMany();
    const hasNext = pageRows.length > safeLimit;
    const pageFeedIds = pageRows.slice(0, safeLimit).map(row => Number(row.feedId));

    if (pageFeedIds.length === 0) {
      return { items: [], nextCursor: null, hasNext: false };
    }

    // 2) 고른 글의 상세를 불러와 1) 의 순서대로 맞춘다
    const queryBuilder = this.dataSource
      .getRepository(FeedEntity)
      .createQueryBuilder('feed')
      .leftJoinAndSelect('feed.record', 'record')
      .leftJoinAndSelect('record.user', 'user')
      .leftJoinAndSelect('record.music', 'music')
      .leftJoinAndSelect('record.files', 'files')

      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(feedLike.id)')
          .from(FeedLikeEntity, 'feedLike')
          .where('feedLike.feedId = feed.id');
      }, 'likeCount')

      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(myLike.id)')
          .from(FeedLikeEntity, 'myLike')
          .where('myLike.feedId = feed.id')
          .andWhere('myLike.userId = :userId');
      }, 'isLikedCount')

      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(myBookmark.id)')
          .from(BookmarkEntity, 'myBookmark')
          .where('myBookmark.feedId = feed.id')
          .andWhere('myBookmark.userId = :userId');
      }, 'isBookmarkedCount')

      .addSelect(subQuery => {
        return subQuery
          .select('COUNT(bookmark.id)')
          .from(BookmarkEntity, 'bookmark')
          .where('bookmark.feedId = feed.id');
      }, 'bookmarkCount')

      .where('feed.id IN (:...pageFeedIds)', { pageFeedIds })
      .setParameter('userId', userId);

    const result = await queryBuilder.getRawAndEntities();
    const rawByFeedId = new Map<number, any>();

    result.raw.forEach(raw => {
      const feedId = Number(raw.feed_id);

      if (!rawByFeedId.has(feedId)) {
        rawByFeedId.set(feedId, raw);
      }
    });

    const feedById = new Map(result.entities.map(feed => [Number(feed.id), feed]));

    const items = pageFeedIds.flatMap(feedId => {
      const feed = feedById.get(feedId);
      if (!feed) return [];

      const raw = rawByFeedId.get(feedId);

      return [
        this.formatFeedResponse(feed, {
          likeCount: Number(raw?.likeCount ?? 0),
          bookmarkCount: Number(raw?.bookmarkCount ?? 0),
          isLiked: Number(raw?.isLikedCount ?? 0) > 0,
          isBookmarked: Number(raw?.isBookmarkedCount ?? 0) > 0,
        }),
      ];
    });

    let nextCursor: number | null = null;

    if (hasNext) {
      nextCursor = sort === 'title'
        ? offset + safeLimit
        : pageFeedIds[pageFeedIds.length - 1];
    }

    return {
      items,
      nextCursor,
      hasNext,
    };
  }

  /*
   * 보관함 - 장르별 기록
   * 한 곡에 장르가 여러 개면 그 글은 모든 장르에 들어갑니다.
   * 커버는 그 장르 곡들 커버 중 하나만 내려줍니다. 프론트가 앱 실행마다 만든 coverSeed 가 같으면
   * 보관함 홈·장르별 기록 어디서 불러도 같은 커버가 나옵니다. (월 목록도 같은 방식)
   * 정렬: 글 수 많은 순 → 최근에 쓴 장르 순
   * Apple Music 이 거의 모든 곡에 붙이는 '음악'(Music) 은 장르로 보지 않습니다.
   * limit 이 없으면 모든 장르를 내려줍니다.
   */
  async getMyFeedGenres(userId: number, limit?: number, coverSeed = '') {
    const rows: Array<{
      genre: string;
      feedCount: number | string;
      artworks: unknown;
    }> = await this.dataSource.query(
      `
      SELECT
        jt.genre AS genre,
        COUNT(DISTINCT feed.id) AS feedCount,
        MAX(feed.id) AS latestFeedId,
        JSON_ARRAYAGG(music.music_artwork) AS artworks
      FROM feed
      JOIN record ON record.id = feed.record_id
      JOIN music ON music.id = record.music_id
      JOIN JSON_TABLE(
        music.music_genre,
        '$[*]' COLUMNS (genre VARCHAR(100) PATH '$')
      ) AS jt
      WHERE record.user_id = ?
        AND feed.deleted_at IS NULL
        AND jt.genre IS NOT NULL
        AND jt.genre <> ''
        AND jt.genre NOT IN (?)
      GROUP BY jt.genre
      ORDER BY feedCount DESC, latestFeedId DESC
      ${limit ? 'LIMIT ?' : ''}
      `,
      limit
        ? [userId, EXCLUDED_ARCHIVE_GENRES, limit]
        : [userId, EXCLUDED_ARCHIVE_GENRES],
    );

    const covers = this.pickSeededCovers(
      rows.map(row => ({ key: `genre:${row.genre}`, artworks: this.toArtworkList(row.artworks) })),
      coverSeed,
    );

    return {
      items: rows.map((row, index) => ({
        genre: row.genre,
        feedCount: Number(row.feedCount),
        artwork: covers[index],
      })),
    };
  }

  /*
   * 보관함 - 모든 기록의 월 목록
   * 글을 쓴 달만 내려갑니다. 월은 한국 시간 기준 'YYYY-MM', 최신 달부터.
   * 커버는 장르별 기록과 같이 coverSeed 로 그 달 곡들 커버 중 하나만 내려줍니다.
   * latestFeedId: 그 달의 가장 최신 글. 프론트는 cursor = latestFeedId + 1 로 GET /feed/me 를 불러
   * 중간 글을 건너뛰고 그 달부터 목록을 시작합니다.
   */
  async getMyFeedMonths(userId: number, limit?: number, coverSeed = '') {
    const rows: Array<{
      month: string;
      feedCount: number | string;
      latestFeedId: number | string;
      artworks: unknown;
    }> = await this.dataSource.query(
      `
      SELECT
        DATE_FORMAT(CONVERT_TZ(record.created_at, '+00:00', '+09:00'), '%Y-%m') AS month,
        COUNT(*) AS feedCount,
        MAX(feed.id) AS latestFeedId,
        JSON_ARRAYAGG(music.music_artwork) AS artworks
      FROM feed
      JOIN record ON record.id = feed.record_id
      JOIN music ON music.id = record.music_id
      WHERE record.user_id = ?
        AND feed.deleted_at IS NULL
      GROUP BY month
      ORDER BY month DESC
      ${limit ? 'LIMIT ?' : ''}
      `,
      limit ? [userId, limit] : [userId],
    );

    const covers = this.pickSeededCovers(
      rows.map(row => ({ key: `month:${row.month}`, artworks: this.toArtworkList(row.artworks) })),
      coverSeed,
    );

    return {
      items: rows.map((row, index) => ({
        month: row.month,
        feedCount: Number(row.feedCount),
        latestFeedId: Number(row.latestFeedId),
        artwork: covers[index],
      })),
    };
  }

  async getMyBookmarkedFeeds(userId: number) { }

  // 사진 파일 확인 용도 코드
  // 음성도 이걸로 확인가능할듯
  async findRecordFileById(fileId: number) {
    const file = await this.dataSource.manager.findOne(RecordFileEntity, {
      where: {
        id: fileId,
      },
    });

    if (!file) {
      throw new NotFoundException('파일을 찾을 수 없습니다.');
    }

    return file;
  }

  private parseMusic(music: string): CreateMusicDto {
    try {
      return JSON.parse(music) as CreateMusicDto;
    } catch {
      throw new BadRequestException('music 형식이 올바르지 않습니다.');
    }
  }

  private formatFeedResponse(
    feed: FeedEntity,
    meta?: {
      likeCount?: number;
      bookmarkCount?: number;
      isLiked?: boolean;
      isBookmarked?: boolean;
      isFollowing?: boolean;
    },
  ) {
    return {
      feedId: feed.id,
      visibility: feed.visibility,
      font: feed.record.font,
      createdAt: feed.record.createdAt,
      updatedAt: feed.record.updatedAt,
      isEdited: this.isEdited(feed.record.createdAt, feed.record.updatedAt),

      user: {
        userId: feed.record.user.id,
        userCode: feed.record.user.userCode,
        nickname: feed.record.user.nickname,
        hasProfileImage: !!feed.record.user.imageMimeType,
        profileImageUrl: this.r2Service.getProfileImageUrl(
          feed.record.user.id,
          feed.record.user.imageMimeType,
          feed.record.user.imageUpdatedAt,
        ),
        isFollowing: meta?.isFollowing ?? false,
      },

      record: {
        recordId: feed.record.id,
        text: feed.record.text,
      },

      music: feed.record.music
        ? {
          musicId: feed.record.music.id,
          externalId: feed.record.music.externalId,
          musicTitle: feed.record.music.musicTitle,
          musicArtist: feed.record.music.musicArtist,
          musicArtwork: feed.record.music.musicArtwork,
          previewUrl: feed.record.music.previewUrl,
        }
        : null,

      files:
        feed.record.files?.map(file => ({
          fileId: file.id,
          fileType: file.fileType,
          mimeType: file.mimeType,
          originalName: file.originalName,
          fileSize: file.fileSize,
          url: this.r2Service.getPublicUrl(file.fileKey),
        })) ?? [],

      likeCount: meta?.likeCount ?? 0,
      bookmarkCount: meta?.bookmarkCount ?? 0,
      isLiked: meta?.isLiked ?? false,
      isBookmarked: meta?.isBookmarked ?? false,
    };
  }

  /*
   * 한국 시간 'YYYY-MM' 한 달을 DB(UTC) datetime 범위로 바꿉니다.
   * created_at 에 함수를 씌우지 않아야 인덱스를 탈 수 있습니다.
   */
  private getKstMonthRange(month: string) {
    const [year, monthIndex] = month.split('-').map(Number);
    const kstOffsetMs = 9 * 60 * 60 * 1000;
    const toDbDatetime = (date: Date) =>
      date.toISOString().slice(0, 19).replace('T', ' ');

    return {
      start: toDbDatetime(new Date(Date.UTC(year, monthIndex - 1, 1) - kstOffsetMs)),
      end: toDbDatetime(new Date(Date.UTC(year, monthIndex, 1) - kstOffsetMs)),
    };
  }

  /*
   * 장르·월 카드마다 커버를 하나씩 고른다. groups 는 화면에 보이는 순서대로 넘긴다.
   * - seed + 카드 key + 커버로 해시를 내서 작은 순으로 고른다 → seed 가 같으면 항상 같은 커버
   * - 앞 카드가 이미 쓴 커버는 피한다 (K-Pop·팝처럼 후보가 같은 장르가 같은 커버가 되지 않도록).
   *   후보를 다 앞 카드가 썼으면 그중 해시가 가장 작은 커버를 쓴다.
   * - 앞에서부터 고르므로 limit 이 달라도 앞쪽 카드 커버는 같다 (보관함 홈 8개 = 장르별 기록 앞 8개)
   */
  private pickSeededCovers(
    groups: Array<{ key: string; artworks: string[] }>,
    seed: string,
  ): Array<string | null> {
    const usedArtworks = new Set<string>();

    return groups.map(({ key, artworks }) => {
      const ranked = artworks
        .map(artwork => ({
          artwork,
          hash: createHash('md5').update(`${seed}:${key}:${artwork}`).digest('hex'),
        }))
        .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));

      const picked = ranked.find(({ artwork }) => !usedArtworks.has(artwork)) ?? ranked[0];
      if (!picked) return null;

      usedArtworks.add(picked.artwork);
      return picked.artwork;
    });
  }

  // JSON_ARRAYAGG 결과(드라이버에 따라 문자열/배열) → 중복·빈 값 없는 커버 URL 목록
  private toArtworkList(value: unknown): string[] {
    let list: unknown = value;

    if (typeof value === 'string') {
      try {
        list = JSON.parse(value);
      } catch {
        return [];
      }
    }

    if (!Array.isArray(list)) {
      return [];
    }

    return [
      ...new Set(
        list.filter(
          (artwork): artwork is string =>
            typeof artwork === 'string' && artwork.trim() !== '',
        ),
      ),
    ];
  }

  private isEdited(createdAt?: Date, updatedAt?: Date) {
    if (!createdAt || !updatedAt) {
      return false;
    }

    return new Date(updatedAt).getTime() > new Date(createdAt).getTime();
  }

  private parseDeleteFileIds(value?: string | string[]): number[] {
    if (!value) {
      return [];
    }

    let rawValues: unknown[];

    if (Array.isArray(value)) {
      rawValues = value;
    } else {
      const trimmed = value.trim();

      if (!trimmed) {
        return [];
      }

      try {
        rawValues = trimmed.startsWith('[')
          ? JSON.parse(trimmed)
          : trimmed.split(',');
      } catch {
        throw new BadRequestException('deleteFileIds 형식이 올바르지 않습니다.');
      }
    }

    const ids = rawValues.map(id => Number(id));

    if (ids.some(id => !id || Number.isNaN(id))) {
      throw new BadRequestException('deleteFileIds 값이 올바르지 않습니다.');
    }

    return [...new Set(ids)];
  }
}