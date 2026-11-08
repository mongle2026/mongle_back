import { UserEntity } from './entities/user.entity';

// 탈퇴한 회원이 남긴 댓글/편지/알림에 보여주는 이름
export const WITHDRAWN_USER_NICKNAME = '(탈퇴한 회원)';

export const isWithdrawnUser = (user: Pick<UserEntity, 'withdrawnAt'>) =>
  !!user.withdrawnAt;

export const getDisplayNickname = (
  user: Pick<UserEntity, 'nickname' | 'withdrawnAt'>,
) => (isWithdrawnUser(user) ? WITHDRAWN_USER_NICKNAME : user.nickname);

// 운영자가 이용을 제한한 회원. 편지함에서 이 이름과 탈퇴 회원 이미지로 보여준다
export const RESTRICTED_USER_NICKNAME = '(이용 제한된 회원)';

// 지금 이용 제한 중인지. 끝나는 시각(restrictedUntil)이 없으면 영구 제한이다
export const isRestrictedUser = (
  user: Pick<UserEntity, 'restrictedAt' | 'restrictedUntil'>,
  now = new Date(),
) =>
  !!user.restrictedAt && (!user.restrictedUntil || user.restrictedUntil > now);

// 영구 정지 중인지. 영구 정지는 경고가 소멸돼도 풀리지 않는다
export const isPermanentlyRestrictedUser = (
  user: Pick<UserEntity, 'restrictedAt' | 'restrictedUntil'>,
) => !!user.restrictedAt && !user.restrictedUntil;
