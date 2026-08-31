import {
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Visibility } from '../enums/visibility.enum';
import { RecordFont } from '../../record/enums/record-font.enum';

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
  @IsEnum(RecordFont)
  font?: RecordFont;
}