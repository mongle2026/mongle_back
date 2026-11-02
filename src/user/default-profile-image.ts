import { randomInt } from 'crypto';

// 기본 프로필 사진 수. 원본은 src/database/seed/default-profile-images/profile_{번호}.png 이고,
// npm run seed:default-profile-images 로 R2 에 올린다. 앱은 사진 파일 없이 서버가 주는 주소만 쓴다
export const DEFAULT_PROFILE_IMAGE_COUNT = 5;

// 사진을 바꾸면 같은 키에 덮어쓰지 말고 버전을 올려 새로 올린다.
// 주소가 같으면 앱 · CDN 캐시에 예전 사진이 남는다. 회원에게는 번호만 저장돼 있어서 데이터는 그대로 둔다
const DEFAULT_PROFILE_IMAGE_VERSION = 'v1';

export const getDefaultProfileImageKey = (defaultProfileImageNo: number) =>
  `defaults/${DEFAULT_PROFILE_IMAGE_VERSION}/profile_${defaultProfileImageNo}.png`;

// 가입할 때 앱이 번호를 보내지 않으면 서버가 고른다
export const pickDefaultProfileImageNo = () =>
  randomInt(1, DEFAULT_PROFILE_IMAGE_COUNT + 1);
