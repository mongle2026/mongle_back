import { BadRequestException, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { MusicEntity } from './entities/music.entity';
import { PopularMusicEntity } from './entities/popular-music.entity';
import { CreateMusicDto } from './dto/create-music.dto';
import axios from 'axios';

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

@Injectable()
export class MusicService {
  constructor(
    @InjectRepository(MusicEntity)
    private readonly musicRepository: Repository<MusicEntity>,
  
    @InjectRepository(PopularMusicEntity)
    private readonly popularMusicRepository: Repository<PopularMusicEntity>,

    private readonly dataSource: DataSource,
  ) {}

  async searchMusic(keyword: string) {
    const trimmedKeyword = keyword?.trim();

    // if (!trimmedKeyword || trimmedKeyword.length < 2) {
    //   throw new BadRequestException('검색어는 2글자 이상 입력해주세요.');
    // }

    const response = await axios.get<ItunesSearchResponse>(
      'https://itunes.apple.com/search',
      {
        params: {
          term: trimmedKeyword,
          country: 'KR',
          media: 'music',
          entity: 'song',
          limit: 20,
        },
      },
    );

    return response.data.results.map((item) => ({
      externalId: String(item.trackId),
      musicTitle: item.trackName,
      musicArtist: item.artistName,
      musicGenre: item.primaryGenreName ? [item.primaryGenreName] : [],
      musicArtwork: item.artworkUrl100,
      previewUrl: item.previewUrl,
    }));
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