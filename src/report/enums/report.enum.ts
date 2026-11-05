// 신고할 수 있는 대상
export enum ReportTargetType {
  FEED = 'FEED',
  COMMENT = 'COMMENT',
  LETTER = 'LETTER',
  USER = 'USER',
}

// 신고 사유. 앱 화면 문구는 프론트가 따로 갖는다.
export enum ReportReason {
  // 스팸 · 광고
  SPAM = 'SPAM',
  // 욕설 · 비방 · 혐오 표현
  ABUSE = 'ABUSE',
  // 음란 · 선정적인 내용
  SEXUAL = 'SEXUAL',
  // 개인정보 노출
  PRIVACY = 'PRIVACY',
  // 저작권 침해
  COPYRIGHT = 'COPYRIGHT',
  // 기타
  ETC = 'ETC',
}

// 디스코드 신고 알림에 보여주는 사유 이름
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  [ReportReason.SPAM]: '스팸 · 광고',
  [ReportReason.ABUSE]: '욕설 · 비방 · 혐오 표현',
  [ReportReason.SEXUAL]: '음란 · 선정적인 내용',
  [ReportReason.PRIVACY]: '개인정보 노출',
  [ReportReason.COPYRIGHT]: '저작권 침해',
  [ReportReason.ETC]: '기타',
};

// 처리 상태. 신고 처리 스크립트(npm run report:handle)가 바꾼다.
export enum ReportStatus {
  PENDING = 'PENDING',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
}

// 처리한 방법. BLIND · RESTRICT 는 RESOLVED, REJECT 는 REJECTED 와 함께 남는다
export enum ReportAction {
  // 피드 · 댓글 · 편지 가림
  BLIND = 'BLIND',
  // 회원 이용 제한
  RESTRICT = 'RESTRICT',
  // 운영정책 위반 없음
  REJECT = 'REJECT',
}

// 이용 제한 기간(일). 'permanent' 는 영구 제한
export const RESTRICTION_DAYS = [3, 7, 30] as const;
export type RestrictionPeriod = (typeof RESTRICTION_DAYS)[number] | 'permanent';
