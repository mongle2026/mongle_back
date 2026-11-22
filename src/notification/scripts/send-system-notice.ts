// src/notification/scripts/send-system-notice.ts
// 공지(시스템 알림)를 모든 회원과 로그인하지 않은 기기에 보낸다.
// DB · R2 · EXPO_ACCESS_TOKEN 환경변수는 서버와 같아야 한다.
//
//   npm run notify:system -- "<제목>" "<내용>"
//   npm run notify:system -- "새 기능 안내" "이제 피드를 저장할 수 있어요.\n지금 확인해 보세요."
//
// 내용에 \n 을 쓰면 줄바꿈이 된다. 보내기 전에 문구를 보여주고 y 를 입력해야 보낸다.

import { NotificationStatus } from '../enums/notification.enum';
import { runNoticeScript } from './notice-script.util';

runNoticeScript({
  status: NotificationStatus.SYSTEM,
  usage: 'npm run notify:system -- "<제목>" "<내용>"',
  audience: '모든 회원(시스템 알림을 끈 회원 제외)과 로그인하지 않은 기기',
  send: async (service, notice) => {
    const { memberCount, guestTokenCount } =
      await service.broadcastSystemNotice(notice);

    return `공지 발송 완료: 회원 ${memberCount}명, 로그인하지 않은 기기 ${guestTokenCount}대`;
  },
});
