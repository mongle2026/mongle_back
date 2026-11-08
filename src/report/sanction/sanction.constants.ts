// 신고 처리로 쌓이는 경고와 이용 제한 규칙
//   경고 1회: 안내만, 2회: 7일 이용 정지, 3회 이상: 영구 정지
//   경고는 부여한 날부터 6개월이 지나면 사라진다 (횟수에서 빠진다). 이미 내려진 영구 정지는 풀리지 않는다

export const WARNING_EXPIRY_MONTHS = 6;

export const SUSPENSION_WARNING_COUNT = 2;
export const SUSPENSION_DAYS = 7;

export const PERMANENT_WARNING_COUNT = 3;

// 제재 종류
export enum SanctionType {
  // 경고 1회 (6개월 뒤 소멸)
  WARNING = 'WARNING',
  // 운영자가 경고 횟수와 관계없이 바로 내린 영구 정지
  BAN = 'BAN',
}

// 제재로 내려진 이용 제한
export enum SanctionRestriction {
  // 경고 누적으로 SUSPENSION_DAYS 일 이용 정지
  SUSPENSION = 'SUSPENSION',
  // 영구 정지
  PERMANENT = 'PERMANENT',
}

// 신고당한 회원에게 보내는 운영정책 안내(policy_notice)에 붙는 제재 내용. 알림 목록 · 푸시 문구가 이걸로 달라진다
export enum SanctionNotice {
  // 경고만 받음 (이용 제한 없음, 또는 이미 더 무거운 제한 중)
  WARNING = 'WARNING',
  // 경고 누적으로 7일 이용 정지
  SUSPENSION = 'SUSPENSION',
  // 영구 정지 (경고 누적 또는 운영자가 바로)
  PERMANENT = 'PERMANENT',
}

export const addMonths = (date: Date, months: number) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * DAY_MS);
