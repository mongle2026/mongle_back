import { NotificationStatus } from './enums/notification.enum';

// 푸시 알림에 들어갈 제목/본문.
// 알림 목록 문구는 프론트(NotificationListItem)가 만들고, 여기 문구는 그것과 같게 맞춰둔다.

const HANGUL_SYLLABLE_START = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;
const JONGSEONG_COUNT = 28;
// 종성 인덱스 8번이 ㄹ
const JONGSEONG_RIEUL = 8;

const getLastSyllableJongseong = (text: string) => {
  const code = text.trim().slice(-1).charCodeAt(0);

  if (!(code >= HANGUL_SYLLABLE_START && code <= HANGUL_SYLLABLE_END)) {
    return 0;
  }

  return (code - HANGUL_SYLLABLE_START) % JONGSEONG_COUNT;
};

// '(으)로부터'. 받침 없거나 ㄹ받침이면 '로부터', 나머지 받침은 '으로부터'
const getFromSuffix = (name: string) => {
  const jongseong = getLastSyllableJongseong(name);

  return jongseong === 0 || jongseong === JONGSEONG_RIEUL
    ? '로부터'
    : '으로부터';
};

const toUserCode = (userCode: string) => `@${userCode.replace(/^@+/, '')}`;

export const buildPushContent = (params: {
  status: NotificationStatus;
  actorNickname?: string | null;
  actorUserCode?: string | null;
  isToSelf?: boolean;
  content?: string | null;
  eventTitle?: string | null;
}): { title: string; body: string } => {
  const nickname = params.actorNickname ?? '';
  const userCode = params.actorUserCode ?? '';

  switch (params.status) {
    case NotificationStatus.SEND:
      return {
        title: `${nickname}에게 편지 도착 예정`,
        body: '편지가 내일 도착할 예정입니다.\n편지가 도착하기 전에 전송 여부를 확인해주세요.',
      };
    case NotificationStatus.RECEIVE:
      return {
        title: `${nickname}${params.isToSelf ? '(나)' : ''}${getFromSuffix(nickname)} 편지 도착`,
        body: '편지함을 확인해 주세요.',
      };
    case NotificationStatus.COMMENT:
      return {
        title: `${toUserCode(userCode)}의 댓글`,
        body: params.content ?? '',
      };
    case NotificationStatus.REPLY:
      return {
        title: `${toUserCode(userCode)}의 답글`,
        body: params.content ?? '',
      };
    case NotificationStatus.SYSTEM:
      return {
        title: '시스템 개선',
        body: '더 편리하게 이용할 수 있도록 개선했습니다.\n새롭게 달라진 기능을 확인해 보세요.',
      };
    case NotificationStatus.EVENT:
      // 광고성 정보는 제목 앞에 (광고) 표기가 필요하다 (정보통신망법 제50조)
      return {
        title: '(광고) 이벤트 알림',
        body: `${params.eventTitle ?? ''} 이벤트가 시작됐습니다.\n지금 바로 참여해 보세요.`,
      };
  }
};
