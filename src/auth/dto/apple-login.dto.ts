import { IsNotEmpty, IsString } from 'class-validator';

export class AppleLoginDto {
  // 앱에서 애플 로그인 후 받은 identity token(JWT). 발급 후 10분이 지나면 만료된다.
  @IsString()
  @IsNotEmpty()
  identityToken!: string;
}
