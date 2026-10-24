import { UserEntity } from './entities/user.entity';

// 탈퇴한 회원이 남긴 댓글/편지/알림에 보여주는 이름
export const WITHDRAWN_USER_NICKNAME = '(탈퇴한 회원)';

export const isWithdrawnUser = (user: Pick<UserEntity, 'withdrawnAt'>) =>
  !!user.withdrawnAt;

export const getDisplayNickname = (
  user: Pick<UserEntity, 'nickname' | 'withdrawnAt'>,
) => (isWithdrawnUser(user) ? WITHDRAWN_USER_NICKNAME : user.nickname);
