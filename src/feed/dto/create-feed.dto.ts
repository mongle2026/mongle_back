import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Visibility } from '../enums/visibility.enum';
import { RecordFont } from '../../record/enums/record-font.enum';
import { Type } from 'class-transformer';
import { RecordFileDto } from '../../record/dto/record-file.dto';

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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecordFileDto)
  @ArrayMaxSize(5)
  files?: RecordFileDto[];
}
