import {
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Visibility } from '../enums/visibility.enum';
import { FeedFont } from '../enums/feed-font.enum';

export class CreateFeedDto {
  @IsNumberString()
  userId!: string;

  @IsString()
  music!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  @IsEnum(Visibility)
  visibility!: Visibility;

  @IsOptional()
  @IsEnum(FeedFont)
  font?: FeedFont;
}