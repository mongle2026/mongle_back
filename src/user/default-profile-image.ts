import { randomInt } from 'crypto';

// 기본 프로필 사진 수. 앱의 il_profile_1~5.png 와 R2 의 defaults/profile_1~5.png 가 같은 사진이다
export const DEFAULT_PROFILE_IMAGE_COUNT = 5;

// 가입할 때 앱이 번호를 보내지 않으면 서버가 고른다
export const pickDefaultProfileImageNo = () =>
  randomInt(1, DEFAULT_PROFILE_IMAGE_COUNT + 1);
