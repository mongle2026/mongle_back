import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateFeedCommentDto {
  @Transform(({ value }) => value?.trim())
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  content!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentCommentId?: number;
}