// src/notification/scripts/send-event-notice.ts
// 이벤트 알림(광고성 정보)을 이벤트 알림을 켠 회원에게만 보낸다. 로그인하지 않은 기기에는 보내지 않는다.
// DB · R2 · EXPO_ACCESS_TOKEN 환경변수는 서버와 같아야 한다.
//
//   npm run notify:event -- "<제목>" "<내용>"
//   npm run notify:event -- "가을 우표 이벤트" "가을 우표를 모으면 선물을 드려요.\n지금 바로 참여해 보세요."
//
// 광고성 정보 표시는 푸시에 자동으로 붙는다. 직접 쓰지 않는다. (정보통신망법 제50조)
// - 제목 · 내용 앞 (광고): 직접 써도 떼고 한 번만 붙인다
// - 내용 끝 수신 거부 방법: 직접 쓰면 두 번 들어가서 보내기 전에 멈춘다
// 야간(21시~8시)에는 보낼 수 없다.
// 내용에 \n 을 쓰면 줄바꿈이 된다. 보내기 전에 문구를 보여주고 y 를 입력해야 보낸다.

import {
  NIGHT_END_HOUR,
  NIGHT_START_HOUR,
  NotificationStatus,
} from '../enums/notification.enum';
import { isKstNightTime } from '../notification.service';
import { NoticeInputError, runNoticeScript } from './notice-script.util';

runNoticeScript({
  status: NotificationStatus.EVENT,
  usage: 'npm run notify:event -- "<제목>" "<내용>"',
  audience: '이벤트 알림을 켠 회원',
  normalize: ({ title, body }) => {
    if (body.includes('수신 거부') || body.includes('수신거부')) {
      throw new NoticeInputError(
        '수신 거부 안내는 내용 끝에 자동으로 붙어요. 내용에서 빼고 다시 실행해 주세요.',
      );
    }

    return {
      title: title.replace(/^\(광고\)\s*/, ''),
      body: body.replace(/^\(광고\)\s*/, ''),
    };
  },
  check: () => {
    if (isKstNightTime(new Date())) {
      throw new NoticeInputError(
        `이벤트 알림은 야간(${NIGHT_START_HOUR}시~${NIGHT_END_HOUR}시)에 보낼 수 없어요. ${NIGHT_END_HOUR}시 이후에 다시 실행해 주세요.`,
      );
    }
  },
  send: async (service, notice) => {
    const { memberCount } = await service.broadcastEventNotice(notice);

    return `이벤트 알림 발송 완료: 회원 ${memberCount}명`;
  },
});
