import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MusicEntity } from './entities/music.entity';
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
  ) {}

  async searchMusic(keyword: string) {
    const trimmedKeyword = keyword?.trim();

    if (!trimmedKeyword || trimmedKeyword.length < 2) {
      throw new BadRequestException('검색어는 2글자 이상 입력해주세요.');
    }

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
}