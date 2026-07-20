import { BadRequestException, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import axios from 'axios';
import { MusicEntity } from './entities/music.entity';
import { PopularMusicEntity } from './entities/popular-music.entity';
import { CreateMusicDto } from './dto/create-music.dto';

interface ItunesSearchItem {
  trackId: number;
  trackName: string;
  artistName: string;
  primaryGenreName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
}

interface ItunesSearchResponse {
  resultCount: number;
  results: ItunesSearchItem[];
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

const ITUNES_MAX_RESULTS = 200;
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
  ) { }

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

    const response = await axios.get<ItunesSearchResponse>(
      'https://itunes.apple.com/search',
      {
        params: {
          term: keyword,
          country: 'KR',
          media: 'music',
          entity: 'song',
          limit: ITUNES_MAX_RESULTS,
        },
      },
    );

    const itemMap = new Map<string, MusicSearchItem>();

    for (const item of response.data.results) {
      const externalId = String(item.trackId);

      if (!itemMap.has(externalId)) {
        itemMap.set(externalId, {
          externalId,
          musicTitle: item.trackName,
          musicArtist: item.artistName,
          musicGenre: item.primaryGenreName ? [item.primaryGenreName] : [],
          musicArtwork: item.artworkUrl100,
          previewUrl: item.previewUrl,
        });
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
    const response = await axios.get<ItunesSearchResponse>(
      'https://itunes.apple.com/search',
      {
        params: {
          term: 'kpop',
          country: 'KR',
          media: 'music',
          entity: 'song',
          limit: 10,
        },
      },
    );

    const songs = response.data.results;
    const chartDate = new Date().toISOString().slice(0, 10);

    await this.dataSource.transaction(async (manager) => {
      const musicRepository = manager.getRepository(MusicEntity);
      const popularMusicRepository = manager.getRepository(PopularMusicEntity);

      await popularMusicRepository.clear();

      for (const [index, song] of songs.entries()) {
        const externalId = String(song.trackId);

        let music = await musicRepository.findOne({
          where: {
            externalId,
          },
        });

        if (!music) {
          music = musicRepository.create({
            externalId,
            musicTitle: song.trackName,
            musicArtist: song.artistName,
            musicGenre: song.primaryGenreName ? [song.primaryGenreName] : null,
            musicArtwork: song.artworkUrl100 ?? null,
            previewUrl: song.previewUrl ?? null,
          });

          music = await musicRepository.save(music);
        } else {
          musicRepository.merge(music, {
            musicTitle: song.trackName,
            musicArtist: song.artistName,
            musicGenre: song.primaryGenreName
              ? [song.primaryGenreName]
              : music.musicGenre,
            musicArtwork: song.artworkUrl100 ?? music.musicArtwork,
            previewUrl: song.previewUrl ?? music.previewUrl,
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
      message: 'iTunes 테스트 인기곡 10개가 갱신되었습니다.',
    };
  }
}