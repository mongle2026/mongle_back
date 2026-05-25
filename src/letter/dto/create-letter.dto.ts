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
  @MaxLength(140)
  text?: string;

  // @IsNumberString()
  // senderId!: string;

  @IsNumberString()
  receiverId!: string;

  @IsOptional()
  @IsDateString()
  deliveryAt?: string;
}