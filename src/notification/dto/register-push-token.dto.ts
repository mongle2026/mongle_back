import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class RegisterPushTokenDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  token!: string;

  @IsIn(['ios', 'android'])
  platform!: string;
}
