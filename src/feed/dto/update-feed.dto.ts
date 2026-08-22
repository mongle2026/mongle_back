import { IsOptional } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateFeedDto } from './create-feed.dto';

export class UpdateFeedDto extends PartialType(
  OmitType(CreateFeedDto, ['userId'] as const),
) {
  @IsOptional()
  deleteFileIds?: string | string[];
}