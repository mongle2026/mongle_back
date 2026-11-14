import { UserEntity } from './entities/user.entity';
import { RestrictionLiftReason } from '../report/sanction/sanction.constants';

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

// 이용 제한을 풀 때 회원에게 넣는 값. 앱이 풀린 뒤 처음 들어올 때 해제 안내 화면을 띄운다
export const buildLiftedRestriction = (
  reason: RestrictionLiftReason.APPEAL_ACCEPTED | RestrictionLiftReason.REVOKED,
) => ({
  restrictedAt: null,
  restrictedUntil: null,
  restrictedReason: null,
  restrictionLiftReason: reason,
});

/*
 * 아직 확인하지 않은 이용 제한 해제 안내. 없으면 null.
 * - 기간이 끝나기 전에 풀렸으면 restriction_lift_reason
 * - 기간이 끝나서 풀렸으면, 끝난 뒤에 해제 안내를 확인하지 않았을 때 EXPIRED
 */
export const getPendingRestrictionLift = (
  user: Pick<
    UserEntity,
    | 'restrictedAt'
    | 'restrictedUntil'
    | 'restrictionLiftReason'
    | 'restrictionLiftAcknowledgedAt'
  >,
  now = new Date(),
): RestrictionLiftReason | null => {
  if (isRestrictedUser(user, now)) {
    return null;
  }

  if (user.restrictionLiftReason) {
    return user.restrictionLiftReason;
  }

  // 제한 중이 아닌데 restricted_at 이 남아 있으면 기간이 끝난 제한이다
  if (
    user.restrictedAt &&
    user.restrictedUntil &&
    (!user.restrictionLiftAcknowledgedAt ||
      user.restrictionLiftAcknowledgedAt < user.restrictedUntil)
  ) {
    return RestrictionLiftReason.EXPIRED;
  }

  return null;
};

// 영구 정지 중인지. 영구 정지는 경고가 소멸돼도 풀리지 않는다
export const isPermanentlyRestrictedUser = (
  user: Pick<UserEntity, 'restrictedAt' | 'restrictedUntil'>,
) => !!user.restrictedAt && !user.restrictedUntil;
