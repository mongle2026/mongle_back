import { BadRequestException, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, Repository } from 'typeorm';
import axios from 'axios';
import { MusicEntity } from './entities/music.entity';
import { PopularMusicEntity } from './entities/popular-music.entity';
import { CreateMusicDto } from './dto/create-music.dto';
import { AppleMusicTokenService } from './apple-music-token.service';

interface AppleMusicArtwork {
  url: string;
  width?: number;
  height?: number;
}

interface AppleMusicSongAttributes {
  name: string;
  artistName: string;
  genreNames?: string[];
  artwork?: AppleMusicArtwork;
  previews?: { url: string }[];
}

interface AppleMusicSong {
  id: string;
  attributes: AppleMusicSongAttributes;
}

interface AppleMusicSearchResponse {
  results?: {
    songs?: {
      data: AppleMusicSong[];
    };
  };
}

interface AppleMusicLookupResponse {
  data?: AppleMusicSong[];
}

export interface MusicSearchItem {
  externalId: string;
  musicTitle: string;
  musicArtist: string;
  musicGenre: string[];
  musicArtwork?: string;
  previewUrl?: string;
}

export interface MusicSearchResponse {
  items: MusicSearchItem[];
  page: number;
  limit: number;
  hasNextPage: boolean;
  nextPage: number | null;
}

interface SearchCacheEntry {
  expiresAt: number;
  items: MusicSearchItem[];
}

// 앨범아트 목표 해상도. 원본이 이보다 작으면 원본 크기로 낮춰서 요청한다.
const ARTWORK_TARGET_SIZE = 1200;
// Apple Music Catalog Search API는 한 요청당 최대 25건만 반환한다.
const APPLE_MUSIC_API_PAGE_LIMIT = 25;
const APPLE_MUSIC_SEARCH_TOTAL = 100;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 100;

// 편지/피드에 쓰인 곡 중 이 기간 이상 갱신 안 된 것만 리프레시 대상으로 삼는다.
const MUSIC_REFRESH_STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;
// 한 번의 리프레시 실행에서 처리할 최대 곡 수 (고유 곡 수 기준이라 편지 수와 무관하게 안전).
const MUSIC_REFRESH_BATCH_SIZE = 200;
// Apple Music Catalog lookup(ids=)도 search와 동일하게 한 요청당 최대 25건까지가 안전하다.
const APPLE_MUSIC_LOOKUP_CHUNK_SIZE = 25;

@Injectable()
export class MusicService {
  private readonly searchCache = new Map<string, SearchCacheEntry>();

  constructor(
    @InjectRepository(MusicEntity)
    private readonly musicRepository: Repository<MusicEntity>,

    @InjectRepository(PopularMusicEntity)
    private readonly popularMusicRepository: Repository<PopularMusicEntity>,

    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly appleMusicTokenService: AppleMusicTokenService,
  ) { }

  private getStorefront(): string {
    return this.configService.get<string>('APPLE_MUSIC_STOREFRONT') ?? 'kr';
  }

  private getAuthHeaders() {
    return {
      Authorization: `Bearer ${this.appleMusicTokenService.getDeveloperToken()}`,
    };
  }

  private resolveArtworkUrl(artwork?: AppleMusicArtwork): string | undefined {
    if (!artwork) {
      return undefined;
    }

    const size = Math.min(
      ARTWORK_TARGET_SIZE,
      artwork.width ?? ARTWORK_TARGET_SIZE,
      artwork.height ?? ARTWORK_TARGET_SIZE,
    );

    return artwork.url.replace('{w}', String(size)).replace('{h}', String(size));
  }

  private toMusicSearchItem(song: AppleMusicSong): MusicSearchItem {
    return {
      externalId: song.id,
      musicTitle: song.attributes.name,
      musicArtist: song.attributes.artistName,
      musicGenre: song.attributes.genreNames ?? [],
      musicArtwork: this.resolveArtworkUrl(song.attributes.artwork),
      previewUrl: song.attributes.previews?.[0]?.url,
    };
  }

  async searchMusic(
    keyword: string,
    page = 1,
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<MusicSearchResponse> {
    const trimmedKeyword = keyword?.trim();

    if (!trimmedKeyword) {
      throw new BadRequestException('검색어를 입력해주세요.');
    }

    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page는 1 이상의 정수여야 합니다.');
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new BadRequestException(
        `limit은 1 이상 ${MAX_PAGE_SIZE} 이하의 정수여야 합니다.`,
      );
    }

    const cacheKey = trimmedKeyword.toLocaleLowerCase('ko-KR');
    const allItems = await this.getSearchItems(cacheKey, trimmedKeyword);

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const items = allItems.slice(startIndex, endIndex);
    const hasNextPage = endIndex < allItems.length;

    return {
      items,
      page,
      limit,
      hasNextPage,
      nextPage: hasNextPage ? page + 1 : null,
    };
  }

  private async getSearchItems(
    cacheKey: string,
    keyword: string,
  ): Promise<MusicSearchItem[]> {
    const cached = this.searchCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.items;
    }

    if (cached) {
      this.searchCache.delete(cacheKey);
    }

    const storefront = this.getStorefront();
    const offsets = Array.from(
      { length: APPLE_MUSIC_SEARCH_TOTAL / APPLE_MUSIC_API_PAGE_LIMIT },
      (_, i) => i * APPLE_MUSIC_API_PAGE_LIMIT,
    );

    const pages = await Promise.all(
      offsets.map((offset) =>
        axios.get<AppleMusicSearchResponse>(
          `https://api.music.apple.com/v1/catalog/${storefront}/search`,
          {
            params: {
              term: keyword,
              types: 'songs',
              limit: APPLE_MUSIC_API_PAGE_LIMIT,
              offset,
            },
            headers: this.getAuthHeaders(),
          },
        ),
      ),
    );

    const itemMap = new Map<string, MusicSearchItem>();

    for (const page of pages) {
      const songs = page.data.results?.songs?.data ?? [];

      for (const song of songs) {
        if (!itemMap.has(song.id)) {
          itemMap.set(song.id, this.toMusicSearchItem(song));
        }
      }
    }

    const items = Array.from(itemMap.values());

    this.setSearchCache(cacheKey, items);

    return items;
  }

  private setSearchCache(cacheKey: string, items: MusicSearchItem[]) {
    if (this.searchCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
      const oldestKey = this.searchCache.keys().next().value as
        | string
        | undefined;

      if (oldestKey) {
        this.searchCache.delete(oldestKey);
      }
    }

    this.searchCache.set(cacheKey, {
      items,
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    });
  }

  async findOrCreateMusic(
    dto: CreateMusicDto,
    manager?: EntityManager,
  ): Promise<MusicEntity> {
    const musicRepository = manager
      ? manager.getRepository(MusicEntity)
      : this.musicRepository;

    const existingMusic = await musicRepository.findOne({
      where: {
        externalId: dto.externalId,
      },
    });

    if (!existingMusic) {
      const music = musicRepository.create({
        externalId: dto.externalId,
        musicTitle: dto.musicTitle,
        musicArtist: dto.musicArtist,
        musicGenre: dto.musicGenre ?? null,
        musicArtwork: dto.musicArtwork ?? null,
        previewUrl: dto.previewUrl ?? null,
      });

      return musicRepository.save(music);
    }

    return this.mergeMusicFields(existingMusic, dto, musicRepository);
  }

  private async mergeMusicFields(
    existingMusic: MusicEntity,
    dto: CreateMusicDto,
    musicRepository: Repository<MusicEntity>,
    alwaysTouch = false,
  ): Promise<MusicEntity> {
    const newGenre = dto.musicGenre?.length ? dto.musicGenre : existingMusic.musicGenre;
    const newArtwork = dto.musicArtwork ?? existingMusic.musicArtwork;
    const newPreviewUrl = dto.previewUrl ?? existingMusic.previewUrl;

    const hasChanges =
      existingMusic.musicTitle !== dto.musicTitle ||
      existingMusic.musicArtist !== dto.musicArtist ||
      existingMusic.musicArtwork !== newArtwork ||
      existingMusic.previewUrl !== newPreviewUrl ||
      JSON.stringify(existingMusic.musicGenre) !== JSON.stringify(newGenre);

    if (!hasChanges && !alwaysTouch) {
      return existingMusic;
    }

    musicRepository.merge(existingMusic, {
      musicTitle: dto.musicTitle,
      musicArtist: dto.musicArtist,
      musicGenre: newGenre,
      musicArtwork: newArtwork,
      previewUrl: newPreviewUrl,
    });

    return musicRepository.save(existingMusic);
  }

  async findPopularMusics() {
    const popularMusics = await this.popularMusicRepository.find({
      order: {
        rank: 'ASC',
      },
    });

    return popularMusics.map((item) => ({
      rank: item.rank,
      id: item.music.id,
      externalId: item.music.externalId,
      musicTitle: item.music.musicTitle,
      musicArtist: item.music.musicArtist,
      musicGenre: item.music.musicGenre,
      musicArtwork: item.music.musicArtwork,
      previewUrl: item.music.previewUrl,
      chartDate: item.chartDate,
    }));
  }

  @Cron('0 0 4 * * *', {
    timeZone: 'Asia/Seoul',
  })
  async refreshPopularMusicsBySchedule() {
    await this.refreshPopularMusics();
  }

  async refreshPopularMusics() {
    const storefront = this.getStorefront();

    const response = await axios.get<AppleMusicSearchResponse>(
      `https://api.music.apple.com/v1/catalog/${storefront}/search`,
      {
        params: {
          term: 'kpop',
          types: 'songs',
          limit: 10,
        },
        headers: this.getAuthHeaders(),
      },
    );

    const songs = response.data.results?.songs?.data ?? [];
    const chartDate = new Date().toISOString().slice(0, 10);

    await this.dataSource.transaction(async (manager) => {
      const popularMusicRepository = manager.getRepository(PopularMusicEntity);

      await popularMusicRepository.clear();

      for (const [index, song] of songs.entries()) {
        const item = this.toMusicSearchItem(song);

        const music = await this.findOrCreateMusic(
          {
            externalId: item.externalId,
            musicTitle: item.musicTitle,
            musicArtist: item.musicArtist,
            musicGenre: item.musicGenre,
            musicArtwork: item.musicArtwork,
            previewUrl: item.previewUrl,
          },
          manager,
        );

        const popularMusic = popularMusicRepository.create({
          rank: index + 1,
          music,
          musicId: music.id,
          chartDate,
        });

        await popularMusicRepository.save(popularMusic);
      }
    });

    return {
      message: 'Apple Music 인기곡 10개가 갱신되었습니다.',
    };
  }

  @Cron('0 30 4 * * 0', {
    timeZone: 'Asia/Seoul',
  })
  async refreshStaleMusicBySchedule() {
    await this.refreshStaleMusic();
  }

  async refreshStaleMusic(batchSize = MUSIC_REFRESH_BATCH_SIZE) {
    const staleBefore = new Date(Date.now() - MUSIC_REFRESH_STALE_THRESHOLD_MS);

    const staleMusics = await this.musicRepository
      .createQueryBuilder('music')
      .where('music.updatedAt < :staleBefore', { staleBefore })
      .orderBy('music.updatedAt', 'ASC')
      .take(batchSize)
      .getMany();

    if (staleMusics.length === 0) {
      return { message: '갱신할 음악이 없습니다.', refreshedCount: 0 };
    }

    const storefront = this.getStorefront();
    const chunks = this.chunkArray(staleMusics, APPLE_MUSIC_LOOKUP_CHUNK_SIZE);
    let refreshedCount = 0;

    for (const chunk of chunks) {
      const ids = chunk.map((music) => music.externalId).join(',');

      const response = await axios.get<AppleMusicLookupResponse>(
        `https://api.music.apple.com/v1/catalog/${storefront}/songs`,
        {
          params: { ids },
          headers: this.getAuthHeaders(),
        },
      );

      const songsById = new Map(
        (response.data.data ?? []).map((song) => [song.id, song]),
      );

      for (const music of chunk) {
        const song = songsById.get(music.externalId);

        if (!song) {
          continue;
        }

        const item = this.toMusicSearchItem(song);

        await this.mergeMusicFields(
          music,
          {
            externalId: item.externalId,
            musicTitle: item.musicTitle,
            musicArtist: item.musicArtist,
            musicGenre: item.musicGenre,
            musicArtwork: item.musicArtwork,
            previewUrl: item.previewUrl,
          },
          this.musicRepository,
          true, // 값이 안 바뀌었어도 updatedAt은 갱신 — 안 그러면 매번 다시 stale 대상으로 잡혀 재조회됨
        );

        refreshedCount++;
      }
    }

    return {
      message: `${refreshedCount}개의 음악 정보가 갱신되었습니다.`,
      refreshedCount,
    };
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }

    return chunks;
  }
}