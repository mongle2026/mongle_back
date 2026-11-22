// src/notification/scripts/send-system-notice.ts
// 공지(시스템 알림)를 모든 회원과 로그인하지 않은 기기에 보낸다.
// DB · R2 · EXPO_ACCESS_TOKEN 환경변수는 서버와 같아야 한다.
//
//   npm run notify:system -- "<제목>" "<내용>"
//   npm run notify:system -- "새 기능 안내" "이제 피드를 저장할 수 있어요.\n지금 확인해 보세요."
//
// 내용에 \n 을 쓰면 줄바꿈이 된다. 보내기 전에 문구를 보여주고 y 를 입력해야 보낸다.

import { createInterface } from 'node:readline/promises';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppDataSource } from '../../database/data-source';
import { StorageModule } from '../../storage/storage.module';
import { NotificationModule } from '../notification.module';
import { NotificationService } from '../notification.service';

// notification.notice_title · content 컬럼 길이
const MAX_TITLE_LENGTH = 100;
const MAX_BODY_LENGTH = 500;

const USAGE = 'npm run notify:system -- "<제목>" "<내용>"';

// AppModule 을 그대로 띄우면 크론까지 돌아서 서버와 겹친다. 알림 발송에 필요한 모듈만 띄운다.
// 크론이 없어서 발송 뒤 영수증 확인(만료 토큰 정리)은 하지 않는다. 발송 응답에서 바로 알려준 만료 토큰만 지운다.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    StorageModule,
    TypeOrmModule.forRoot({ ...AppDataSource.options, migrations: [] }),
    NotificationModule,
  ],
})
class SendSystemNoticeModule {}

class NoticeInputError extends Error {}

// 이모지도 한 글자로 센다 (MySQL utf8mb4 VARCHAR 길이와 같다)
const countChars = (text: string) => Array.from(text).length;

const parseNotice = (args: string[]) => {
  const [rawTitle, rawBody, ...rest] = args;

  if (rawTitle === undefined || rawBody === undefined || rest.length > 0) {
    throw new NoticeInputError(
      `제목과 내용을 하나씩 따옴표로 감싸서 넘겨 주세요.\n  ${USAGE}`,
    );
  }

  const title = rawTitle.trim();
  // 명령줄에서는 줄바꿈을 넘기기 어려워서 \n 글자를 줄바꿈으로 바꾼다
  const body = rawBody.replace(/\\n/g, '\n').trim();

  if (!title || !body) {
    throw new NoticeInputError('제목과 내용은 비울 수 없어요.');
  }

  if (countChars(title) > MAX_TITLE_LENGTH) {
    throw new NoticeInputError(
      `제목은 ${MAX_TITLE_LENGTH}자까지 쓸 수 있어요.`,
    );
  }

  if (countChars(body) > MAX_BODY_LENGTH) {
    throw new NoticeInputError(`내용은 ${MAX_BODY_LENGTH}자까지 쓸 수 있어요.`);
  }

  return { title, body };
};

// 보내면 되돌릴 수 없어서 문구를 보여주고 한 번 더 묻는다
const confirmNotice = async (notice: { title: string; body: string }) => {
  console.log('\n아래 공지를 모든 회원과 로그인하지 않은 기기에 보냅니다.');
  console.log('──────────────────────────────');
  console.log(`제목: ${notice.title}`);
  console.log(`내용:\n${notice.body}`);
  console.log('──────────────────────────────');

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const answer = await rl.question('보낼까요? (y/N) ');

    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
};

async function sendSystemNotice() {
  const notice = parseNotice(process.argv.slice(2));

  if (!(await confirmNotice(notice))) {
    console.log('보내지 않았어요.');
    return;
  }

  const app = await NestFactory.createApplicationContext(
    SendSystemNoticeModule,
  );

  try {
    const { memberCount, guestTokenCount } = await app
      .get(NotificationService)
      .broadcastSystemNotice(notice);

    console.log(
      `공지 발송 완료: 회원 ${memberCount}명, 로그인하지 않은 기기 ${guestTokenCount}대`,
    );
  } finally {
    await app.close();
  }
}

sendSystemNotice().catch((error) => {
  // 입력이 잘못됐으면 안내 문구만, 발송 중 실패는 원인을 볼 수 있게 전부 찍는다
  console.error(error instanceof NoticeInputError ? error.message : error);
  process.exit(1);
});
