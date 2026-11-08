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

// 처리한 방법. REJECT 는 REJECTED, 나머지는 RESOLVED 와 함께 남는다
export enum ReportAction {
  // 피드 · 댓글 · 편지 가림. 작성자에게 경고 1회
  BLIND = 'BLIND',
  // 회원 신고: 경고 1회 (가릴 글이 없다)
  WARN = 'WARN',
  // 경고 횟수와 관계없이 바로 영구 정지. 글 신고면 글도 가린다
  BAN = 'BAN',
  // 운영정책 위반 없음
  REJECT = 'REJECT',
  // 예전 방식: 운영자가 기간(3 · 7 · 30일 · 영구)을 골라 회원 이용 제한. 지금은 쓰지 않고 예전 기록만 남아 있다
  RESTRICT = 'RESTRICT',
}
