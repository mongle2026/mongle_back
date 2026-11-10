// 사용자 행동 기록 종류. 추천 피드 개선 · 분석용으로 쌓는다 (아직 추천 점수에는 쓰지 않는다)
export enum UserEventType {
  // ── 앱이 보내는 이벤트 (POST /events) ──
  // 피드 상세에 머문 시간. duration_ms = 화면을 보고 있던 시간 (앱이 백그라운드에 있던 시간은 빼고)
  FEED_DETAIL_VIEW = 'FEED_DETAIL_VIEW',
  // 미리듣기를 한 번 틀었다가 멈출 때까지. duration_ms = 실제로 소리가 나온 시간,
  // position_ms = 멈춘 지점(곡 안에서 몇 초), detail = 멈춘 이유(MusicListenEndReason)
  MUSIC_LISTEN = 'MUSIC_LISTEN',

  // ── 서버가 남기는 이벤트 (실제로 상태가 바뀌었을 때만) ──
  LIKE = 'LIKE',
  UNLIKE = 'UNLIKE',
  BOOKMARK = 'BOOKMARK',
  UNBOOKMARK = 'UNBOOKMARK',
}

export const CLIENT_USER_EVENT_TYPES = [
  UserEventType.FEED_DETAIL_VIEW,
  UserEventType.MUSIC_LISTEN,
] as const;

export type ClientUserEventType = (typeof CLIENT_USER_EVENT_TYPES)[number];

export type ServerUserEventType =
  | UserEventType.LIKE
  | UserEventType.UNLIKE
  | UserEventType.BOOKMARK
  | UserEventType.UNBOOKMARK;

// MUSIC_LISTEN 이 끝난 이유
export enum MusicListenEndReason {
  // 재생 버튼으로 일시정지
  PAUSE = 'PAUSE',
  // 미리듣기 끝까지 들음
  END = 'END',
  // 다른 곡을 틀어서 넘어감
  SWITCH = 'SWITCH',
  // 그 밖에 멈춤 (스크롤로 다른 글로 넘어감, 탭 전환, 화면 나감, 앱 백그라운드 등)
  STOP = 'STOP',
}
