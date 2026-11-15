import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class WithdrawDto {
  // 애플 회원만. 탈퇴 직전에 애플 로그인을 한 번 더 해서 받은 authorization code.
  // 발급 후 5분 안에 한 번만 쓸 수 있다. 카카오 회원은 보내지 않는다.
  // 로그인 때 authorizationCode 를 보내 서버가 애플 refresh token 을 받아 둔 회원은 보내지 않아도 된다.
  // 받아 둔 값이 없는 회원이 보내지 않으면 400
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  authorizationCode?: string;
}
