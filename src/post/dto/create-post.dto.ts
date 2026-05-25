import {
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Visibility } from '../enums/visibility.enum';

export class CreatePostDto {
  @IsNumberString()
  userId!: string;

  @IsString()
  music!: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  text?: string;

  @IsEnum(Visibility)
  visibility!: Visibility;
}