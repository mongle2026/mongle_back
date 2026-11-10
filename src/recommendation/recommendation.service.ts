import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Brackets, DataSource } from 'typeorm';
import { FeedEntity } from '../feed/entities/feed.entity';
import { Visibility } from '../feed/enums/visibility.enum';
import { notBlockedBetweenSql } from '../block/block.sql';
import { RECOMMENDATION_CONFIG as CONFIG } from './recommendation.config';
import { UserEventType } from '../user-event/enums/user-event.enum';
import { MixBucket, MixCandidate, mixFeed } from './recommendation-mixer';
import {
  RecommendationCursor,
  decodeRecommendationCursor,
  encodeRecommendationCursor,
} from './recommendation-cursor';

const DAY_MS = 24 * 60 * 60 * 1000;

// 피드 홈 목록과 같은 기준: 글쓴이가 지금 이용 제한 중이 아닌 글만 (feed.service.ts NOT_RESTRICTED_AUTHOR_SQL 과 같다)
const NOT_RESTRICTED_AUTHOR_SQL =
  '(user.restrictedAt IS NULL OR user.restrictedUntil <= :now)';

// 노출 기록 정리 크론이 한 번에 지우는 최대 줄 수
const IMPRESSION_PURGE_BATCH = 5000;

type PoolRow = {
  feedId: string | number;
  authorId: string | number;
  musicId: string | number;
  createdAt: Date;
  musicArtist: string | null;
  musicGenre: unknown;
  weeklyLikeCount: string | number;
  weeklyCommentCount: string | number;
  weeklyBookmarkCount: string | number;
};

interface Candidate extends MixCandidate {
  createdAt: Date;
  artistKey: string | null;
  genres: string[];
  isFollowingAuthor: boolean;
  weeklyLikeCount: number;
  weeklyCommentCount: number;
  weeklyBookmarkCount: number;
  // 이전 탐색(새로고침 전)에서 이미 내려준 글
  seenBefore: boolean;
  // 이번 탐색의 앞 페이지에서 이미 내려준 글. 다시 주지 않는다
  servedThisSession: boolean;
  popularScore: number;
  preferenceScore: number;
  followingScore: number;
}

// 음악 · 아티스트 · 장르마다 0~1. 내 취향 중 가장 강한 것이 1
interface PreferenceProfile {
  // 취향 신호 개수. 적으면 선호도 비중을 줄이고 인기 순위로 채운다
  signalCount: number;
  music: Map<number, number>;
  artist: Map<string, number>;
  genre: Map<string, number>;
}

export interface RecommendedPage {
  // 이 순서대로 카드로 만들어 내려준다
  feedIds: number[];
  nextCursor: string | null;
  hasNext: boolean;
}

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(private readonly dataSource: DataSource) { }

  /**
   * 추천 피드 한 페이지의 feedId 목록.
   * userId 가 없으면(로그인 전) 전체 공개 글을 인기 순위로만 준다.
   * followingIds 는 FeedService 가 이미 불러온 값을 넘겨받는다 (카드의 isFollowing 에도 같이 쓴다).
   */
  async getRecommendedPage(params: {
    userId?: number;
    followingIds: number[];
    cursor?: string;
    limit: number;
  }): Promise<RecommendedPage> {
    const { userId, followingIds, limit } = params;
    const cursor = params.cursor ? decodeRecommendationCursor(params.cursor) : undefined;
    const now = new Date();

    if (userId === undefined) {
      return this.getGuestPage({ cursor, limit, now });
    }

    return this.getMemberPage({ userId, followingIds, cursor, limit, now });
  }

  // 로그인 전: 인기 순위 100%. 노출 기록이 없어서 전체 순서를 만든 뒤 offset 만큼 건너뛴다
  private async getGuestPage(params: {
    cursor?: RecommendationCursor;
    limit: number;
    now: Date;
  }): Promise<RecommendedPage> {
    const { cursor, limit, now } = params;
    const offset = cursor?.o ?? 0;

    const [rows, popularContext] = await Promise.all([
      this.loadCandidatePool({ followingIds: [], now }),
      this.loadPopularContext(now),
    ]);

    const candidates = rows.map(row =>
      this.toCandidate(row, { followingSet: new Set(), impressions: new Map(), sessionStart: now }),
    );
    candidates.forEach(candidate => {
      candidate.popularScore = this.scorePopular(candidate, popularContext);
    });

    const popular = this.sortByScore(candidates.filter(c => c.popularScore > 0), c => c.popularScore);
    const fallback = this.sortByRecency(candidates.filter(c => c.popularScore <= 0));

    const ordered = mixFeed({
      buckets: [{ key: 'popular', ratio: 1, items: popular }],
      fallback,
      limit: candidates.length,
      sameAuthorGap: CONFIG.spacing.sameAuthorGap,
      sameMusicGap: CONFIG.spacing.sameMusicGap,
    });

    const page = ordered.slice(offset, offset + limit).map(entry => entry.item.feedId);
    const hasNext = offset + limit < ordered.length;

    return {
      feedIds: page,
      hasNext,
      nextCursor: hasNext
        ? encodeRecommendationCursor({ s: cursor?.s ?? now.getTime(), o: offset + page.length, r: [] })
        : null,
    };
  }

  private async getMemberPage(params: {
    userId: number;
    followingIds: number[];
    cursor?: RecommendationCursor;
    limit: number;
    now: Date;
  }): Promise<RecommendedPage> {
    const { userId, followingIds, cursor, limit, now } = params;
    const sessionStart = new Date(cursor?.s ?? now.getTime());
    const isFirstPage = !cursor;

    const [rows, popularContext, profile, impressions, signedUpAt] = await Promise.all([
      this.loadCandidatePool({ userId, followingIds, now }),
      this.loadPopularContext(now),
      this.loadPreferenceProfile(userId, now),
      this.loadImpressions(userId, now),
      this.loadSignedUpAt(userId),
    ]);

    const followingSet = new Set(followingIds);
    const allCandidates = rows.map(row =>
      this.toCandidate(row, { followingSet, impressions, sessionStart }),
    );
    const byFeedId = new Map(allCandidates.map(c => [c.feedId, c]));

    // 이번 탐색에서 이미 내려준 글은 다시 주지 않는다
    const candidates = allCandidates.filter(c => !c.servedThisSession);

    for (const candidate of candidates) {
      const seenFactor = candidate.seenBefore ? CONFIG.seen.penalty : 1;

      candidate.popularScore = this.scorePopular(candidate, popularContext) * seenFactor;
      candidate.preferenceScore = this.scorePreference(candidate, profile, now) * seenFactor;
      candidate.followingScore = candidate.isFollowingAuthor
        ? this.freshness(candidate.createdAt, now, CONFIG.following.freshnessHalfLifeDays) * seenFactor
        : 0;
    }

    // 첫 페이지(새로고침)에는 이미 본 글을 올리지 않는다. 볼 글이 모자랄 때만 맨 뒤에서 채운다
    const holdBackSeen = isFirstPage && CONFIG.seen.excludeOnFirstPage;
    const rankable = holdBackSeen ? candidates.filter(c => !c.seenBefore) : candidates;
    const heldBack = holdBackSeen ? candidates.filter(c => c.seenBefore) : [];

    const followingItems = this.sortByScore(rankable.filter(c => c.followingScore > 0), c => c.followingScore);
    const preferenceItems = this.sortByScore(rankable.filter(c => c.preferenceScore > 0), c => c.preferenceScore);
    const popularItems = this.sortByScore(rankable.filter(c => c.popularScore > 0), c => c.popularScore);

    const mix = this.resolveMix({
      hasFollowingCandidates: followingItems.length > 0,
      signalCount: profile.signalCount,
      isNewUser:
        !!signedUpAt && now.getTime() - signedUpAt.getTime() < CONFIG.newUser.days * DAY_MS,
    });

    const buckets: MixBucket<Candidate>[] = [
      { key: 'following', ratio: mix.following, items: followingItems },
      { key: 'preference', ratio: mix.preference, items: preferenceItems },
      { key: 'popular', ratio: mix.popular, items: popularItems },
    ];

    // 버킷에 못 든 글(점수 0)은 최신순으로, 그다음 첫 페이지에서 미뤄 둔 이미 본 글
    const fallback = [
      ...this.sortByRecency(rankable),
      ...this.sortByRecency(heldBack),
    ];

    const recent = (cursor?.r ?? [])
      .map(feedId => byFeedId.get(feedId))
      .filter((c): c is Candidate => !!c);

    const picked = mixFeed({
      buckets,
      fallback,
      limit,
      recent,
      sameAuthorGap: CONFIG.spacing.sameAuthorGap,
      sameMusicGap: CONFIG.spacing.sameMusicGap,
    });

    const feedIds = picked.map(entry => entry.item.feedId);
    await this.saveImpressions(userId, feedIds, now);

    const hasNext = candidates.length > feedIds.length;
    const tailSize = Math.max(CONFIG.spacing.sameAuthorGap, CONFIG.spacing.sameMusicGap);

    return {
      feedIds,
      hasNext,
      nextCursor: hasNext
        ? encodeRecommendationCursor({
          s: sessionStart.getTime(),
          o: (cursor?.o ?? 0) + feedIds.length,
          r: feedIds.slice(-tailSize),
        })
        : null,
    };
  }

  /**
   * 기획 규칙에 따른 비율 (합 1).
   * - 팔로우한 사람의 후보 글이 없으면 팔로우 몫은 0. 페이지 중간에 바닥나면 mixFeed 가 남은 버킷끼리 나눠 채운다
   * - 취향 신호가 적으면 선호도 몫을 줄이고 그만큼 인기 순위에 준다
   * - 신규 가입 회원이고 취향 신호가 다 차지 않았으면 인기 몫을 newUser.minPopularShare 이상으로 둔다
   */
  private resolveMix(params: {
    hasFollowingCandidates: boolean;
    signalCount: number;
    isNewUser: boolean;
  }) {
    const { minSignals, fullSignals } = CONFIG.preference;
    const confidence =
      params.signalCount < minSignals
        ? 0
        : Math.min(1, params.signalCount / fullSignals);

    let following = params.hasFollowingCandidates ? CONFIG.mix.following : 0;
    let preference = CONFIG.mix.preference * confidence;
    let popular = CONFIG.mix.popular + (CONFIG.mix.preference - preference);

    // 팔로우 몫이 빠졌으면 남은 둘을 합 1 로 맞춘다 (mixFeed 도 같은 비율로 나눈다)
    const total = following + preference + popular;
    following /= total;
    preference /= total;
    popular /= total;

    if (params.isNewUser && params.signalCount < fullSignals) {
      let lack = Math.max(0, CONFIG.newUser.minPopularShare - popular);

      const fromPreference = Math.min(lack, preference);
      preference -= fromPreference;
      lack -= fromPreference;

      const fromFollowing = Math.min(lack, following);
      following -= fromFollowing;

      popular += fromPreference + fromFollowing;
    }

    return { following, preference, popular };
  }

  // 가입 시각. 신규 회원 판단용
  private async loadSignedUpAt(userId: number) {
    const rows = (await this.dataSource.query(
      'SELECT created_at AS createdAt FROM `user` WHERE id = ?',
      [userId],
    )) as { createdAt: Date | null }[];

    const createdAt = rows[0]?.createdAt;
    return createdAt ? new Date(createdAt) : null;
  }

  // 추천 후보: 볼 수 있는 최근 글. 내 글 · 차단 관계 · 이용 제한 회원 · 가린 글은 뺀다
  private async loadCandidatePool(params: {
    userId?: number;
    followingIds: number[];
    now: Date;
  }): Promise<PoolRow[]> {
    const { userId, followingIds, now } = params;

    const queryBuilder = this.dataSource
      .getRepository(FeedEntity)
      .createQueryBuilder('feed')
      .innerJoin('feed.record', 'record')
      .innerJoin('record.user', 'user')
      .innerJoin('record.music', 'music')
      .select('feed.id', 'feedId')
      .addSelect('record.userId', 'authorId')
      .addSelect('record.musicId', 'musicId')
      .addSelect('record.createdAt', 'createdAt')
      .addSelect('music.musicArtist', 'musicArtist')
      .addSelect('music.musicGenre', 'musicGenre')
      .addSelect(
        `(SELECT COUNT(*) FROM feed_like wl
          WHERE wl.feed_id = feed.id AND wl.created_at >= :popularSince)`,
        'weeklyLikeCount',
      )
      // 글쓴이 본인 댓글은 세지 않는다
      .addSelect(
        `(SELECT COUNT(*) FROM feed_comment wc
          WHERE wc.feed_id = feed.id AND wc.created_at >= :popularSince
            AND wc.user_id <> record.user_id
            AND wc.deleted_at IS NULL AND wc.blinded_at IS NULL)`,
        'weeklyCommentCount',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM bookmark wb
          WHERE wb.feed_id = feed.id AND wb.created_at >= :popularSince)`,
        'weeklyBookmarkCount',
      )
      .where('feed.deletedAt IS NULL')
      .andWhere('feed.blindedAt IS NULL')
      .andWhere('record.createdAt >= :candidateSince')
      .andWhere('user.withdrawnAt IS NULL')
      .andWhere(NOT_RESTRICTED_AUTHOR_SQL)
      .andWhere(
        new Brackets(qb => {
          qb.where('feed.visibility = :publicVisibility', {
            publicVisibility: Visibility.PUBLIC,
          });

          // 팔로우한 사람의 팔로워 공개 글
          if (followingIds.length > 0) {
            qb.orWhere(
              new Brackets(followQb => {
                followQb
                  .where('feed.visibility = :followerVisibility', {
                    followerVisibility: Visibility.FOLLOWER,
                  })
                  .andWhere('record.userId IN (:...followingIds)', { followingIds });
              }),
            );
          }
        }),
      )
      .setParameters({
        now,
        candidateSince: new Date(now.getTime() - CONFIG.candidate.windowDays * DAY_MS),
        popularSince: new Date(now.getTime() - CONFIG.popular.windowDays * DAY_MS),
      })
      .orderBy('feed.id', 'DESC')
      .limit(CONFIG.candidate.poolSize);

    if (userId !== undefined) {
      queryBuilder
        // 본인 게시물은 추천하지 않는다
        .andWhere('record.userId <> :userId', { userId })
        .andWhere(notBlockedBetweenSql(':userId', 'record.user_id'));
    }

    return queryBuilder.getRawMany<PoolRow>();
  }

  // 인기 순위에 쓰는 음악 단위 값: 최근 편지에 담긴 횟수, 애플뮤직 차트 순위
  private async loadPopularContext(now: Date) {
    const popularSince = new Date(now.getTime() - CONFIG.popular.windowDays * DAY_MS);

    const [letterRows, chartRows] = await Promise.all([
      this.dataSource.query(
        `SELECT r.music_id AS musicId, COUNT(*) AS letterCount
           FROM letter l
           INNER JOIN record r ON r.id = l.record_id
          WHERE r.created_at >= ? AND l.blinded_at IS NULL
          GROUP BY r.music_id`,
        [popularSince],
      ) as Promise<{ musicId: string; letterCount: string }[]>,
      this.dataSource.query(
        'SELECT music_id AS musicId, `rank` AS chartRank FROM popular_music',
      ) as Promise<{ musicId: string; chartRank: number }[]>,
    ]);

    const chartSize = chartRows.reduce((max, row) => Math.max(max, Number(row.chartRank)), 0);

    return {
      letterCountByMusic: new Map(letterRows.map(row => [Number(row.musicId), Number(row.letterCount)])),
      // 1위는 1, 마지막 순위는 1/chartSize
      chartScoreByMusic: new Map(
        chartRows.map(row => [
          Number(row.musicId),
          chartSize > 0 ? (chartSize - Number(row.chartRank) + 1) / chartSize : 0,
        ]),
      ),
    };
  }

  /*
   * 취향 프로필. 신호마다 그 음악 · 아티스트 · 장르에 점수를 더한다.
   * 1. 직접 기록한 음악 (피드 · 편지 모두 record)
   * 2. 재생도 하고 반응도 남긴 글의 음악
   * 3. 반응만 남긴 글의 음악. 반응 = 좋아요 · 북마크 · 댓글 · 상세를 오래 읽음(user_event FEED_DETAIL_VIEW)
   * 4. 재생만 해 본 음악. 틀자마자 끈 곡(user_event MUSIC_LISTEN 합이 짧음)은 빼고
   */
  private async loadPreferenceProfile(userId: number, now: Date): Promise<PreferenceProfile> {
    const since = new Date(now.getTime() - CONFIG.preference.windowDays * DAY_MS);
    const { detailViewMinMs, listenMinMs } = CONFIG.preference.engagement;

    const [ownRows, interactedRows, playedRows] = await Promise.all([
      this.dataSource.query(
        'SELECT music_id AS musicId FROM record WHERE user_id = ? AND created_at >= ?',
        [userId, since],
      ) as Promise<{ musicId: string }[]>,
      // 반응을 여러 개 남겨도 글 하나는 한 번만 센다. 내 글에 남긴 반응은 1번(직접 기록)에서 이미 셌다.
      // 상세 체류는 한 번 본 것이 여러 줄로 나뉠 수 있어서 글마다 더한 시간으로 본다
      this.dataSource.query(
        `SELECT x.feed_id AS feedId, r.music_id AS musicId
           FROM (
             SELECT feed_id FROM feed_like WHERE user_id = ? AND created_at >= ?
             UNION
             SELECT feed_id FROM bookmark WHERE user_id = ? AND created_at >= ?
             UNION
             SELECT feed_id FROM feed_comment WHERE user_id = ? AND created_at >= ? AND deleted_at IS NULL
             UNION
             SELECT feed_id FROM user_event
              WHERE user_id = ? AND event_type = ? AND occurred_at >= ?
              GROUP BY feed_id
             HAVING SUM(duration_ms) >= ?
           ) x
           INNER JOIN feed f ON f.id = x.feed_id
           INNER JOIN record r ON r.id = f.record_id
          WHERE r.user_id <> ?`,
        [
          userId, since,
          userId, since,
          userId, since,
          userId, UserEventType.FEED_DETAIL_VIEW, since, detailViewMinMs,
          userId,
        ],
      ) as Promise<{ feedId: string; musicId: string }[]>,
      // 틀어 본 곡(music_play) 중 들은 시간 합이 listenMinMs 보다 짧은 곡은 뺀다.
      // 들은 시간 기록이 없으면(앱이 보내기 전에 종료 등) 틀어 본 것만으로 센다
      this.dataSource.query(
        `SELECT mp.music_id AS musicId
           FROM music_play mp
          WHERE mp.user_id = ? AND mp.last_played_at >= ?
            AND NOT EXISTS (
              SELECT 1 FROM user_event ue
               WHERE ue.user_id = mp.user_id AND ue.music_id = mp.music_id
                 AND ue.event_type = ? AND ue.occurred_at >= ?
               GROUP BY ue.music_id
              HAVING SUM(ue.duration_ms) < ?
            )`,
        [userId, since, UserEventType.MUSIC_LISTEN, since, listenMinMs],
      ) as Promise<{ musicId: string }[]>,
    ]);

    const { signalWeights } = CONFIG.preference;
    const playedSet = new Set(playedRows.map(row => Number(row.musicId)));
    const interactedMusicSet = new Set<number>();
    const signals: { musicId: number; weight: number }[] = [];

    for (const row of ownRows) {
      signals.push({ musicId: Number(row.musicId), weight: signalWeights.ownRecord });
    }

    for (const row of interactedRows) {
      const musicId = Number(row.musicId);
      interactedMusicSet.add(musicId);
      signals.push({
        musicId,
        weight: playedSet.has(musicId)
          ? signalWeights.playedAndInteracted
          : signalWeights.interacted,
      });
    }

    for (const musicId of playedSet) {
      if (!interactedMusicSet.has(musicId)) {
        signals.push({ musicId, weight: signalWeights.played });
      }
    }

    const profile: PreferenceProfile = {
      signalCount: signals.length,
      music: new Map(),
      artist: new Map(),
      genre: new Map(),
    };

    if (signals.length === 0) {
      return profile;
    }

    const musicIds = [...new Set(signals.map(signal => signal.musicId))];
    const musicRows = (await this.dataSource.query(
      'SELECT id, music_artist AS musicArtist, music_genre AS musicGenre FROM music WHERE id IN (?)',
      [musicIds],
    )) as { id: string; musicArtist: string | null; musicGenre: unknown }[];

    const musicInfo = new Map(
      musicRows.map(row => [
        Number(row.id),
        { artistKey: this.toArtistKey(row.musicArtist), genres: this.toGenres(row.musicGenre) },
      ]),
    );

    const add = <K>(map: Map<K, number>, key: K, weight: number) =>
      map.set(key, (map.get(key) ?? 0) + weight);

    for (const { musicId, weight } of signals) {
      add(profile.music, musicId, weight);

      const info = musicInfo.get(musicId);
      if (!info) continue;

      if (info.artistKey) add(profile.artist, info.artistKey, weight);
      info.genres.forEach(genre => add(profile.genre, genre, weight));
    }

    this.normalizeToMax(profile.music);
    this.normalizeToMax(profile.artist);
    this.normalizeToMax(profile.genre);

    return profile;
  }

  private async loadImpressions(userId: number, now: Date) {
    const since = new Date(now.getTime() - CONFIG.seen.retentionDays * DAY_MS);
    const rows = (await this.dataSource.query(
      'SELECT feed_id AS feedId, served_at AS servedAt FROM feed_impression WHERE user_id = ? AND served_at >= ?',
      [userId, since],
    )) as { feedId: string; servedAt: Date }[];

    return new Map(rows.map(row => [Number(row.feedId), new Date(row.servedAt)]));
  }

  // 내려준 글을 노출 기록에 남긴다. 실패해도 피드는 그대로 주고, 다음 페이지에 같은 글이 섞일 수 있을 뿐이다
  private async saveImpressions(userId: number, feedIds: number[], now: Date) {
    if (feedIds.length === 0) return;

    const placeholders = feedIds.map(() => '(?, ?, ?)').join(', ');
    const values = feedIds.flatMap(feedId => [userId, feedId, now]);

    try {
      await this.dataSource.query(
        `INSERT INTO feed_impression (user_id, feed_id, served_at)
         VALUES ${placeholders} AS new
         ON DUPLICATE KEY UPDATE served_at = new.served_at`,
        values,
      );
    } catch (error) {
      this.logger.warn(`노출 기록 저장 실패 (userId=${userId}): ${String(error)}`);
    }
  }

  /**
   * 미리듣기 재생 기록 (POST /feed/:feedId/play). 그 글의 음악을 "재생해 본 음악"으로 남긴다.
   * 회원 · 음악마다 한 줄이라, 다시 재생하면 횟수와 마지막 재생 시각만 바뀐다.
   */
  async recordPlay(userId: number, feedId: number) {
    const now = new Date();
    const result = (await this.dataSource.query(
      `INSERT INTO music_play (user_id, music_id, play_count, last_played_at, created_at)
       SELECT ?, r.music_id, 1, ?, ?
         FROM feed f
         INNER JOIN record r ON r.id = f.record_id
        WHERE f.id = ? AND f.deleted_at IS NULL
       ON DUPLICATE KEY UPDATE play_count = music_play.play_count + 1, last_played_at = ?`,
      [userId, now, now, feedId, now],
    )) as { affectedRows?: number };

    if (!result.affectedRows) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    }

    return { message: '재생 기록이 저장되었습니다.' };
  }

  // 보관 기간이 지난 노출 기록 정리. 다른 정리 크론(03:00~04:30)과 겹치지 않게 04:50 에 돈다
  @Cron('0 50 4 * * *', { timeZone: 'Asia/Seoul' })
  async purgeOldImpressions() {
    const cutoff = new Date(Date.now() - CONFIG.seen.retentionDays * DAY_MS);

    for (let batch = 0; batch < 20; batch++) {
      const result = (await this.dataSource.query(
        'DELETE FROM feed_impression WHERE served_at < ? LIMIT ?',
        [cutoff, IMPRESSION_PURGE_BATCH],
      )) as { affectedRows?: number };

      if ((result.affectedRows ?? 0) < IMPRESSION_PURGE_BATCH) break;
    }
  }

  private toCandidate(
    row: PoolRow,
    context: { followingSet: Set<number>; impressions: Map<number, Date>; sessionStart: Date },
  ): Candidate {
    const feedId = Number(row.feedId);
    const authorId = Number(row.authorId);
    const servedAt = context.impressions.get(feedId);

    return {
      feedId,
      authorId,
      musicId: Number(row.musicId),
      createdAt: new Date(row.createdAt),
      artistKey: this.toArtistKey(row.musicArtist),
      genres: this.toGenres(row.musicGenre),
      isFollowingAuthor: context.followingSet.has(authorId),
      weeklyLikeCount: Number(row.weeklyLikeCount),
      weeklyCommentCount: Number(row.weeklyCommentCount),
      weeklyBookmarkCount: Number(row.weeklyBookmarkCount),
      seenBefore: !!servedAt && servedAt < context.sessionStart,
      servedThisSession: !!servedAt && servedAt >= context.sessionStart,
      popularScore: 0,
      preferenceScore: 0,
      followingScore: 0,
    };
  }

  private scorePopular(
    candidate: Candidate,
    context: Awaited<ReturnType<RecommendationService['loadPopularContext']>>,
  ) {
    const { weights } = CONFIG.popular;

    return (
      candidate.weeklyLikeCount * weights.like +
      candidate.weeklyCommentCount * weights.comment +
      candidate.weeklyBookmarkCount * weights.bookmark +
      (context.letterCountByMusic.get(candidate.musicId) ?? 0) * weights.letterMusic +
      (context.chartScoreByMusic.get(candidate.musicId) ?? 0) * weights.appleChart
    );
  }

  // 취향과 겹치는 정도. 음악 · 아티스트 · 장르(여러 개면 가장 잘 맞는 것) 일치도에 가중치를 곱해 더한다
  private scorePreference(candidate: Candidate, profile: PreferenceProfile, now: Date) {
    if (profile.signalCount === 0) return 0;

    const { matchWeights, freshnessHalfLifeDays } = CONFIG.preference;

    const musicMatch = profile.music.get(candidate.musicId) ?? 0;
    const artistMatch = candidate.artistKey ? profile.artist.get(candidate.artistKey) ?? 0 : 0;
    const genreMatch = candidate.genres.reduce(
      (best, genre) => Math.max(best, profile.genre.get(genre) ?? 0),
      0,
    );

    const match =
      musicMatch * matchWeights.sameMusic +
      artistMatch * matchWeights.sameArtist +
      genreMatch * matchWeights.sameGenre;

    return match * this.freshness(candidate.createdAt, now, freshnessHalfLifeDays);
  }

  // 반감기 halfLifeDays 로 줄어드는 신선도 (방금 쓴 글 1, halfLifeDays 지나면 0.5)
  private freshness(createdAt: Date, now: Date, halfLifeDays: number) {
    const ageDays = Math.max(0, now.getTime() - createdAt.getTime()) / DAY_MS;
    return Math.pow(0.5, ageDays / halfLifeDays);
  }

  // 값을 가장 큰 값 대비 0~1 로 바꾼다
  private normalizeToMax<K>(map: Map<K, number>) {
    let max = 0;
    map.forEach(value => { max = Math.max(max, value); });
    if (max <= 0) return;
    map.forEach((value, key) => map.set(key, value / max));
  }

  // 점수 높은 순, 같으면 최신 글 먼저
  private sortByScore(items: Candidate[], score: (c: Candidate) => number) {
    return [...items].sort((a, b) => score(b) - score(a) || b.feedId - a.feedId);
  }

  private sortByRecency(items: Candidate[]) {
    return [...items].sort((a, b) => b.feedId - a.feedId);
  }

  private toArtistKey(artist: string | null) {
    const key = artist?.trim().toLowerCase();
    return key ? key : null;
  }

  // music_genre(JSON) → 장르 배열. 드라이버에 따라 문자열로 올 수도 있다
  private toGenres(value: unknown): string[] {
    let genres: unknown = value;

    if (typeof value === 'string') {
      try {
        genres = JSON.parse(value);
      } catch {
        return [];
      }
    }

    if (!Array.isArray(genres)) return [];

    const excluded = new Set<string>(CONFIG.excludedGenres);
    return genres.filter(
      (genre): genre is string => typeof genre === 'string' && !excluded.has(genre),
    );
  }
}
