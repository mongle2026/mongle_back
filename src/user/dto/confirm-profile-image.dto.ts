import { IsString } from 'class-validator';

export class ConfirmProfileImageDto {
  @IsString()
  mimeType!: string; // image/jpeg 만 허용 (경로가 .jpg 고정이므로)
}
