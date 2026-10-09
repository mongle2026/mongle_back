import { IsNotEmpty, IsString } from 'class-validator';
import { IsNickname, IsUserCode } from '../../user/user-profile.validation';

export class SignupDto {
  // 카카오/애플 로그인에서 isNewUser 와 함께 받은 토큰. 어떤 소셜 계정으로 가입하는지 서버가 직접 확인한다.
  @IsString()
  @IsNotEmpty()
  signupToken!: string;

  @IsNickname()
  nickname!: string;

  @IsUserCode()
  userCode!: string;
}
