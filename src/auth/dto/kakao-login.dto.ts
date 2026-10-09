import { IsNotEmpty, IsString } from 'class-validator';

export class KakaoLoginDto {
  // 앱에서 카카오 SDK 로그인 후 받은 카카오 access token
  @IsString()
  @IsNotEmpty()
  accessToken!: string;
}
