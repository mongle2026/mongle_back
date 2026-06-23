import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In, LessThan } from 'typeorm';
import { CreateMusicDto } from '../music/dto/create-music.dto';
import { CreateFeedDto } from './dto/create-feed.dto';
import { FeedEntity } from './entities/feed.entity';
import { RecordService } from '../record/record.service';
import { RecordFileEntity } from 'src/record/entities/record-file.entity';
import { FeedLikeEntity } from 'src/like/entities/feed-like.entity';
import { BookmarkEntity } from 'src/bookmark/entities/bookmark.entity';
import { RecordEntity } from 'src/record/entities/record.entity';

@Injectable()
export class FeedService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly recordService: RecordService,
  ) { }

  async createFeed(dto: CreateFeedDto, files: Express.Multer.File[]) {
    const music = this.parseMusic(dto.music);

    return this.dataSource.transaction(async (manager) => {
      const record = await this.recordService.createBaseRecord(manager, {
        userId: Number(dto.userId),
        music,
        text: dto.text,
        files,
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

  async getFeeds(userId: number) {
    const result = await this.dataSource
      .getRepository(FeedEntity)
      .createQueryBuilder('feed')
      .leftJoinAndSelect('feed.record', 'record')
      .leftJoinAndSelect('record.user', 'user')
      .leftJoinAndSelect('record.music', 'music')
      .leftJoinAndSelect('record.files', 'files')

      // 좋아요 총 개수
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(feedLike.id)')
          .from(FeedLikeEntity, 'feedLike')
          .where('feedLike.feedId = feed.id');
      }, 'likeCount')

      // 내가 좋아요 눌렀는지
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(myLike.id)')
          .from(FeedLikeEntity, 'myLike')
          .where('myLike.feedId = feed.id')
          .andWhere('myLike.userId = :userId');
      }, 'isLikedCount')

      // 내가 북마크했는지
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(myBookmark.id)')
          .from(BookmarkEntity, 'myBookmark')
          .where('myBookmark.feedId = feed.id')
          .andWhere('myBookmark.userId = :userId');
      }, 'isBookmarkedCount')

      .setParameter('userId', userId)
      .orderBy('record.createdAt', 'DESC')
      .getRawAndEntities();

    const rawByFeedId = new Map<number, any>();

    result.raw.forEach((raw) => {
      const feedId = Number(raw.feed_id);

      if (!rawByFeedId.has(feedId)) {
        rawByFeedId.set(feedId, raw);
      }
    });

    return result.entities.map((feed) => {
      const raw = rawByFeedId.get(Number(feed.id));

      return this.formatFeedResponse(feed, {
        likeCount: Number(raw?.likeCount ?? 0),
        isLiked: Number(raw?.isLikedCount ?? 0) > 0,
        isBookmarked: Number(raw?.isBookmarkedCount ?? 0) > 0,
      });
    });
  }

  async getFeedDetail(feedId: number, userId: number) {
    const result = await this.dataSource
      .getRepository(FeedEntity)
      .createQueryBuilder('feed')
      .leftJoinAndSelect('feed.record', 'record')
      .leftJoinAndSelect('record.user', 'user')
      .leftJoinAndSelect('record.music', 'music')
      .leftJoinAndSelect('record.files', 'files')

      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(feedLike.id)')
          .from(FeedLikeEntity, 'feedLike')
          .where('feedLike.feedId = feed.id');
      }, 'likeCount')

      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(myLike.id)')
          .from(FeedLikeEntity, 'myLike')
          .where('myLike.feedId = feed.id')
          .andWhere('myLike.userId = :userId');
      }, 'isLikedCount')

      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(myBookmark.id)')
          .from(BookmarkEntity, 'myBookmark')
          .where('myBookmark.feedId = feed.id')
          .andWhere('myBookmark.userId = :userId');
      }, 'isBookmarkedCount')

      .addSelect((subQuery) => {
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

    const raw = result.raw[0];

    return this.formatFeedResponse(feed, {
      likeCount: Number(raw.likeCount ?? 0),
      bookmarkCount: Number(raw.bookmarkCount ?? 0),
      isLiked: Number(raw.isLikedCount ?? 0) > 0,
      isBookmarked: Number(raw.isBookmarkedCount ?? 0) > 0,
    });
  }

  async deleteFeed(feedId: number, userId: number) {
    if (!feedId || Number.isNaN(feedId)) {
      throw new BadRequestException('feedId가 올바르지 않습니다.');
    }

    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('userId가 올바르지 않습니다.');
    }

    return this.dataSource.transaction(async (manager) => {
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

      await manager.delete(FeedLikeEntity, {
        feedId,
      });

      await manager.delete(BookmarkEntity, {
        feedId,
      });

      await manager.softDelete(FeedEntity, {
        id: feedId,
      });

      return {
        message: '피드가 삭제되었습니다.',
        feedId,
      };
    });
  }

  async purgeDeletedFeeds(days = 30, limit = 100) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return this.dataSource.transaction(async (manager) => {
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

      const feedIds = feeds.map((feed) => Number(feed.id));
      const recordIds = [
        ...new Set(feeds.map((feed) => Number(feed.recordId))),
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

      const recordFileDeleteResult = await manager.delete(RecordFileEntity, {
        recordId: In(recordIds),
      });

      const recordDeleteResult = await manager.delete(RecordEntity, {
        id: In(recordIds),
      });

      return {
        message: '삭제 보관 기간이 지난 피드가 물리 삭제되었습니다.',
        deletedFeedCount: feedDeleteResult.affected ?? 0,
        deletedRecordFileCount: recordFileDeleteResult.affected ?? 0,
        deletedRecordCount: recordDeleteResult.affected ?? 0,
      };
    });
  }

  async likeFeed(feedId: number, userId: number) {
    return this.dataSource.transaction(async (manager) => {
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

      // 이미 좋아요를 눌렀으면 중복 생성하지 않음
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
    return this.dataSource.transaction(async (manager) => {
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

      // 좋아요가 없으면 삭제할 것도 없음
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
    return this.dataSource.transaction(async (manager) => {
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
    return this.dataSource.transaction(async (manager) => {
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

    console.log('파일 조회 테스트:', {
      id: file.id,
      mimeType: file.mimeType,
      originalName: file.originalName,
      isBuffer: Buffer.isBuffer(file.fileData),
      size: file.fileData?.length,
    });

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
    },
  ) {
    return {
      feedId: feed.id,
      visibility: feed.visibility,
      createdAt: feed.record.createdAt,
      updatedAt: feed.record.updatedAt,

      user: {
        userId: feed.record.user.id,
        userCode: feed.record.user.userCode,
        nickname: feed.record.user.nickname,
        hasProfileImage: !!feed.record.user.imageMimeType,
        profileImageUrl: feed.record.user.imageMimeType
          ? `/user/${feed.record.user.id}/profile-image`
          : null,
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

      files: feed.record.files?.map((file) => ({
        fileId: file.id,
        fileType: file.fileType,
        mimeType: file.mimeType,
        originalName: file.originalName,
        fileSize: file.fileSize,
        url: `/record-file/${file.id}`,
      })) ?? [],

      likeCount: meta?.likeCount ?? 0,
      bookmarkCount: meta?.bookmarkCount ?? 0,
      isLiked: meta?.isLiked ?? false,
      isBookmarked: meta?.isBookmarked ?? false,
    };
  }
}