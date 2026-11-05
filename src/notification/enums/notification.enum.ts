// 알림 목록 화면의 탭(피드/편지/소식)과 같은 분류
export enum NotificationType {
  FEED = 'feed',
  LETTER = 'letter',
  NEWS = 'news',
}

// 분류 안의 세부 종류. 목록 문구는 type + status 조합으로 프론트가 만든다.
export enum NotificationStatus {
  // 편지: 보낸 사람에게 "내일 도착 예정"
  SEND = 'send',
  // 편지: 받는 사람에게 "편지 도착"
  RECEIVE = 'receive',
  COMMENT = 'comment',
  REPLY = 'reply',
  SYSTEM = 'system',
  EVENT = 'event',
  // 피드 탭: 나를 팔로우한 사람
  FOLLOW = 'follow',
  // 소식: 신고한 사람에게 "신고한 대상이 처리됨"
  REPORT_RESOLVED = 'report_resolved',
  // 소식: 신고한 사람에게 "검토했지만 위반 없음"
  REPORT_REJECTED = 'report_rejected',
  // 소식: 신고당한 사람에게 "운영정책에 따라 가려짐 / 이용 제한됨"
  POLICY_NOTICE = 'policy_notice',
}

// 운영 조치 안내라 알림 설정과 관계없이 항상 보낸다.
// 푸시 채널과 야간 규칙(야간 알림을 끈 사람은 아침에 푸시)은 시스템 알림(system)을 따른다
export const ALWAYS_DELIVERED_STATUSES: ReadonlySet<NotificationStatus> =
  new Set([
    NotificationStatus.REPORT_RESOLVED,
    NotificationStatus.REPORT_REJECTED,
    NotificationStatus.POLICY_NOTICE,
  ]);

// 사용자가 켜고 끄는 단위. 여러 status 가 하나의 설정으로 묶일 수 있다. (댓글 + 답글)
// 알림 종류 key 는 안드로이드 알림 채널 id 로도 그대로 쓴다. (NIGHT 은 종류가 아니라 채널이 없다)
export enum NotificationSettingKey {
  FOLLOW = 'follow',
  COMMENT = 'comment',
  LETTER_SENT = 'letter_sent',
  LETTER_RECEIVED = 'letter_received',
  SYSTEM = 'system',
  EVENT = 'event',
  // 야간(NIGHT_START_HOUR ~ NIGHT_END_HOUR)에도 푸시를 받을지. 끄면 아침에 모아서 보낸다.
  NIGHT = 'night',
}

export const NOTIFICATION_TYPE_BY_STATUS: Record<
  NotificationStatus,
  NotificationType
> = {
  [NotificationStatus.SEND]: NotificationType.LETTER,
  [NotificationStatus.RECEIVE]: NotificationType.LETTER,
  [NotificationStatus.COMMENT]: NotificationType.FEED,
  [NotificationStatus.REPLY]: NotificationType.FEED,
  [NotificationStatus.SYSTEM]: NotificationType.NEWS,
  [NotificationStatus.EVENT]: NotificationType.NEWS,
  [NotificationStatus.FOLLOW]: NotificationType.FEED,
  [NotificationStatus.REPORT_RESOLVED]: NotificationType.NEWS,
  [NotificationStatus.REPORT_REJECTED]: NotificationType.NEWS,
  [NotificationStatus.POLICY_NOTICE]: NotificationType.NEWS,
};

export const NOTIFICATION_SETTING_KEY_BY_STATUS: Record<
  NotificationStatus,
  NotificationSettingKey
> = {
  [NotificationStatus.SEND]: NotificationSettingKey.LETTER_SENT,
  [NotificationStatus.RECEIVE]: NotificationSettingKey.LETTER_RECEIVED,
  [NotificationStatus.COMMENT]: NotificationSettingKey.COMMENT,
  [NotificationStatus.REPLY]: NotificationSettingKey.COMMENT,
  [NotificationStatus.SYSTEM]: NotificationSettingKey.SYSTEM,
  [NotificationStatus.EVENT]: NotificationSettingKey.EVENT,
  [NotificationStatus.FOLLOW]: NotificationSettingKey.FOLLOW,
  // 끌 수 없는 알림(ALWAYS_DELIVERED_STATUSES). 푸시 채널과 야간 규칙만 시스템 알림을 따른다
  [NotificationStatus.REPORT_RESOLVED]: NotificationSettingKey.SYSTEM,
  [NotificationStatus.REPORT_REJECTED]: NotificationSettingKey.SYSTEM,
  [NotificationStatus.POLICY_NOTICE]: NotificationSettingKey.SYSTEM,
};

// 설정 행이 없을 때의 값. 이벤트(광고성 정보)는 사용자가 직접 동의해야 해서 기본 OFF.
export const NOTIFICATION_SETTING_DEFAULTS: Record<
  NotificationSettingKey,
  boolean
> = {
  [NotificationSettingKey.FOLLOW]: true,
  [NotificationSettingKey.COMMENT]: true,
  [NotificationSettingKey.LETTER_SENT]: true,
  [NotificationSettingKey.LETTER_RECEIVED]: true,
  [NotificationSettingKey.SYSTEM]: true,
  [NotificationSettingKey.EVENT]: false,
  [NotificationSettingKey.NIGHT]: true,
};

// 야간 시간대(KST). 시작 시각 이상 ~ 끝 시각 미만
export const NIGHT_START_HOUR = 21;
export const NIGHT_END_HOUR = 8;

// 야간에 미뤄둔 알림을 아침에 묶어서 보내는 푸시의 안드로이드 채널
export const NIGHT_SUMMARY_CHANNEL_ID = 'night_summary';

// 알림 목록은 최근 30일만 보여주고, 그보다 오래된 행은 정리 크론이 지운다.
export const NOTIFICATION_RETENTION_DAYS = 30;
