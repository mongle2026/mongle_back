import { IsOptional } from 'class-validator';
import { IsNickname, IsUserCode } from '../user-profile.validation';

// 프로필 수정. 보낸 항목만 바꾼다.
export class UpdateUserDto {
  @IsOptional()
  @IsNickname()
  nickname?: string;

  @IsOptional()
  @IsUserCode()
  userCode?: string;
}
