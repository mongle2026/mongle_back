import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateMusicDto {
  @IsString()
  externalId!: string;

  @IsString()
  musicTitle!: string;

  @IsString()
  musicArtist!: string;

  @IsOptional()
  @IsArray()
  musicGenre?: string[] | null;

  @IsOptional()
  @IsString()
  musicArtwork?: string | null;

  @IsOptional()
  @IsString()
  previewUrl?: string | null;
}