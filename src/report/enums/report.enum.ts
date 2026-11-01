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

// 처리 상태. 관리 화면이 없어서 지금은 DB 에서 직접 바꾼다.
export enum ReportStatus {
  PENDING = 'PENDING',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
}
