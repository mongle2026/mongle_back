import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// 앱 심사용 계정 로그인. 값은 env 의 REVIEW_LOGIN_ID / REVIEW_LOGIN_PASSWORD 와 비교한다
export class ReviewLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  loginId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  password!: string;
}
