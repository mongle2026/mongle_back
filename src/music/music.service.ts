import { BadRequestException, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
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

  async findOrCreateMusic(dto: CreateMusicDto): Promise<MusicEntity> {
    const existingMusic = await this.musicRepository.findOne({
      where: {
        externalId: dto.externalId,
      },
    });

    if (existingMusic) {
      return existingMusic;
    }

    const music = this.musicRepository.create({
      externalId: dto.externalId,
      musicTitle: dto.musicTitle,
      musicArtist: dto.musicArtist,
      musicGenre: dto.musicGenre ?? null,
      musicArtwork: dto.musicArtwork ?? null,
      previewUrl: dto.previewUrl ?? null,
    });

    return this.musicRepository.save(music);
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
      const musicRepository = manager.getRepository(MusicEntity);
      const popularMusicRepository = manager.getRepository(PopularMusicEntity);

      await popularMusicRepository.clear();

      for (const [index, song] of songs.entries()) {
        const item = this.toMusicSearchItem(song);

        let music = await musicRepository.findOne({
          where: {
            externalId: item.externalId,
          },
        });

        if (!music) {
          music = musicRepository.create({
            externalId: item.externalId,
            musicTitle: item.musicTitle,
            musicArtist: item.musicArtist,
            musicGenre: item.musicGenre.length ? item.musicGenre : null,
            musicArtwork: item.musicArtwork ?? null,
            previewUrl: item.previewUrl ?? null,
          });

          music = await musicRepository.save(music);
        } else {
          musicRepository.merge(music, {
            musicTitle: item.musicTitle,
            musicArtist: item.musicArtist,
            musicGenre: item.musicGenre.length ? item.musicGenre : music.musicGenre,
            musicArtwork: item.musicArtwork ?? music.musicArtwork,
            previewUrl: item.previewUrl ?? music.previewUrl,
          });

          music = await musicRepository.save(music);
        }

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
}