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
}

// 사용자가 켜고 끄는 단위. 여러 status 가 하나의 설정으로 묶일 수 있다. (댓글 + 답글)
// 안드로이드 알림 채널 id 로도 그대로 쓴다.
export enum NotificationSettingKey {
  COMMENT = 'comment',
  LETTER_SENT = 'letter_sent',
  LETTER_RECEIVED = 'letter_received',
  SYSTEM = 'system',
  EVENT = 'event',
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
};

// 설정 행이 없을 때의 값. 이벤트(광고성 정보)는 사용자가 직접 동의해야 해서 기본 OFF.
export const NOTIFICATION_SETTING_DEFAULTS: Record<
  NotificationSettingKey,
  boolean
> = {
  [NotificationSettingKey.COMMENT]: true,
  [NotificationSettingKey.LETTER_SENT]: true,
  [NotificationSettingKey.LETTER_RECEIVED]: true,
  [NotificationSettingKey.SYSTEM]: true,
  [NotificationSettingKey.EVENT]: false,
};

// 알림 목록은 최근 30일만 보여주고, 그보다 오래된 행은 정리 크론이 지운다.
export const NOTIFICATION_RETENTION_DAYS = 30;
