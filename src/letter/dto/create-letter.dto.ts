import {
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateLetterDto {
  @IsNumberString()
  userId!: string;

  @IsString()
  music!: string;

  // 엥? 텍스트는 record에 있잖아? 
  // @IsOptional()
  // @IsString()
  // @MaxLength(140)
  // text?: string;

  // @IsNumberString()
  // senderId!: string;

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
}