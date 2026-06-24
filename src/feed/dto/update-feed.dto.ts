import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Visibility } from '../enums/visibility.enum';
import { PartialType } from '@nestjs/mapped-types';
import { CreateFeedDto } from './create-feed.dto';

export class UpdateFeedDto extends PartialType(CreateFeedDto) {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @IsOptional()
  @IsString()
  music?: string;

  // form-data에서는 "1,2" 또는 ["1", "2"] 형태가 될 수 있음
  @IsOptional()
  deleteFileIds?: string | string[];
}
