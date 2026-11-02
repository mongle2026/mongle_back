import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { DEFAULT_PROFILE_IMAGE_COUNT } from '../../user/default-profile-image';
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

  // POST /user/profile-image/upload-url 로 받아 사진을 올린 키. 사진을 고르지 않았으면 보내지 않는다.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  profileImageKey?: string;

  // 가입 화면에서 보여준 기본 프로필 사진 번호. 사진을 골랐어도 보낸다(나중에 사진을 지우면 이 사진으로 돌아간다).
  // 보내지 않으면 서버가 고른다.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(DEFAULT_PROFILE_IMAGE_COUNT)
  defaultProfileImageNo?: number;

  // 약관 화면의 (선택) 광고성 정보 수신 동의. 이벤트 알림 설정으로 저장한다. 보내지 않으면 비동의로 본다.
  @IsOptional()
  @IsBoolean()
  isMarketingAgreed?: boolean;
}
