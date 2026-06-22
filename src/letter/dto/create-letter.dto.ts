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
}