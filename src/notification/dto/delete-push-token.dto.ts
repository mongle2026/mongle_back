import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DeletePushTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  token!: string;
}
