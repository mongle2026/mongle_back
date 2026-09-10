import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { LetterboxTab } from '../enums/letterbox-tab.enum';

export class GetLetterboxQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;

  @IsEnum(LetterboxTab)
  tab!: LetterboxTab;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  cursor?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
