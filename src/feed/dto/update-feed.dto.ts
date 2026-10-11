import { IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateFeedDto } from './create-feed.dto';

export class UpdateFeedDto extends PartialType(CreateFeedDto) {
  @IsOptional()
  deleteFileIds?: string | string[];
}