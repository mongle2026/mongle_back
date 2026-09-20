import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { RecordFont } from '../../record/enums/record-font.enum';
import { Type } from 'class-transformer';
import { RecordFileDto } from '../../record/dto/record-file.dto';

export class CreateLetterDto {
  @IsNumberString()
  userId!: string;

  @IsString()
  music!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  @IsNumberString()
  receiverId!: string;

  @IsString()
  pattern!: string;

  @IsString()
  color!: string;

  @IsString()
  stamp!: string;

  @IsOptional()
  @IsDateString()
  deliveryAt?: string;

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
