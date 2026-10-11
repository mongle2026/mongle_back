import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { RecordFont } from '../../record/enums/record-font.enum';
import { Type } from 'class-transformer';
import { RecordFileDto } from '../../record/dto/record-file.dto';

export class CreateLetterDto {
  @IsString()
  music!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  // 받는 사람의 publicId
  @IsUUID()
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
