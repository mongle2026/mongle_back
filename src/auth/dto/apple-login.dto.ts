import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AppleLoginDto {
  // 앱에서 애플 로그인 후 받은 identity token(JWT). 발급 후 10분이 지나면 만료된다.
  @IsString()
  @IsNotEmpty()
  identityToken!: string;

  // 같은 애플 로그인에서 받은 authorization code. 발급 후 5분 안에 한 번만 쓸 수 있다.
  // 탈퇴할 때 애플 연결을 끊는 데 쓸 refresh token 으로 바꿔 둔다.
  // 이 값을 보내기 전의 앱 버전을 위해 선택값으로 둔다
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  authorizationCode?: string;
}
