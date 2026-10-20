import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsNickname, IsUserCode } from '../user-profile.validation';

// 프로필 수정. 보낸 항목만 바꾼다.
export class UpdateUserDto {
  @IsOptional()
  @IsNickname()
  nickname?: string;

  @IsOptional()
  @IsUserCode()
  userCode?: string;

  // POST /user/profile-image/upload-url 로 받아 사진을 올린 키.
  // 보내지 않으면 지금 사진을 그대로 두고, null 이면 사진을 지워서 기본 프로필로 되돌린다.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  profileImageKey?: string | null;
}
