// 개인정보처리방침의 신고 · 제재 기록 보관 기간. 매일 moderation-retention.service.ts 가 지난 기록을 지운다

// 신고: 처리와 이의 제기 절차가 끝나고 이 기간이 지나면 지운다.
// 방침은 '끝난 뒤 5일 이내 파기'라서, 운영자가 잘못 처리한 신고를 되돌릴 여유를 두되
// 하루 한 번 도는 정리가 하루 밀려도 5일을 넘지 않게 한다
export const REPORT_PURGE_GRACE_DAYS = 3;

// 경고 · 이용 제한 기록(user_sanction, user.restricted_*)과 이의 신청: 처리가 끝난 뒤 1년
export const MODERATION_RECORD_RETENTION_MONTHS = 12;

// 재가입 제한(banned_account): 영구 정지된 회원(운영자가 탈퇴시킨 회원 포함)은 탈퇴 후 1년.
// 기간 정지 중에 탈퇴한 회원은 정지가 끝나는 시각까지
export const PERMANENT_REJOIN_BAN_MONTHS = 12;
