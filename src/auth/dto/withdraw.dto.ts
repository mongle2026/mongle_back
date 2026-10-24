import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class WithdrawDto {
  // 애플 회원은 필수. 탈퇴 직전에 애플 로그인을 한 번 더 해서 받은 authorization code.
  // 발급 후 5분 안에 한 번만 쓸 수 있다. 카카오 회원은 보내지 않는다.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  authorizationCode?: string;
}
