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

  // 답글을 달 원댓글. 답글에 답글을 달아도 값은 그 답글의 원댓글 id 다.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rootCommentId?: number;
}