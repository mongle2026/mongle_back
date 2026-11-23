// src/notification/scripts/notice-script.util.ts
// 공지(notify:system) · 이벤트(notify:event) 스크립트가 같이 쓰는 부분.
// 제목 · 내용을 받아서 확인하고, 문구를 보여주고 y 를 입력하면 보낸다.

import { createInterface } from 'node:readline/promises';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppDataSource } from '../../database/data-source';
import { StorageModule } from '../../storage/storage.module';
import { NotificationModule } from '../notification.module';
import { NotificationStatus } from '../enums/notification.enum';
import { buildPushContent } from '../notification-message.util';
import { BroadcastNotice, NotificationService } from '../notification.service';

type BroadcastStatus = NotificationStatus.SYSTEM | NotificationStatus.EVENT;

// notification.notice_title · content 컬럼 길이
const MAX_TITLE_LENGTH = 100;
const MAX_BODY_LENGTH = 500;

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
class SendNoticeModule {}

// 입력이 잘못됐을 때. 안내 문구만 찍고 끝낸다
export class NoticeInputError extends Error {}

// 이모지도 한 글자로 센다 (PostgreSQL VARCHAR 길이도 글자 수로 센다)
const countChars = (text: string) => Array.from(text).length;

const parseNotice = (args: string[], usage: string): BroadcastNotice => {
  const [rawTitle, rawBody, ...rest] = args;

  if (rawTitle === undefined || rawBody === undefined || rest.length > 0) {
    throw new NoticeInputError(
      `제목과 내용을 하나씩 따옴표로 감싸서 넘겨 주세요.\n  ${usage}`,
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
// 실제로 보낼 푸시 문구를 같은 함수(buildPushContent)로 만들어 보여준다 (이벤트: (광고) · 수신 거부 안내 포함)
const confirmNotice = async (params: {
  audience: string;
  status: BroadcastStatus;
  notice: BroadcastNotice;
}) => {
  const push = buildPushContent({
    status: params.status,
    noticeTitle: params.notice.title,
    content: params.notice.body,
  });

  console.log('\n아래 푸시를 보냅니다.');
  console.log('──────────────────────────────');
  console.log(`받는 대상: ${params.audience}`);
  console.log(`제목: ${push.title}`);
  console.log(`내용:\n${push.body}`);
  console.log('──────────────────────────────');

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const answer = await rl.question('보낼까요? (y/N) ');

    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
};

export const runNoticeScript = (options: {
  status: BroadcastStatus;
  usage: string;
  // 확인 문구에 보여줄 받는 사람
  audience: string;
  // 입력을 다듬는다 (이벤트: 직접 쓴 (광고) 를 뗀다)
  normalize?: (notice: BroadcastNotice) => BroadcastNotice;
  // 보내기 전에 막아야 할 때 NoticeInputError 를 던진다 (이벤트: 야간)
  check?: () => void;
  send: (
    service: NotificationService,
    notice: BroadcastNotice,
  ) => Promise<string>;
}) => {
  const run = async () => {
    const parsed = parseNotice(process.argv.slice(2), options.usage);
    const notice = options.normalize ? options.normalize(parsed) : parsed;

    if (!notice.title) {
      throw new NoticeInputError('제목은 비울 수 없어요.');
    }

    options.check?.();

    const confirmed = await confirmNotice({
      audience: options.audience,
      status: options.status,
      notice,
    });

    if (!confirmed) {
      console.log('보내지 않았어요.');
      return;
    }

    const app = await NestFactory.createApplicationContext(SendNoticeModule);

    try {
      console.log(await options.send(app.get(NotificationService), notice));
    } finally {
      await app.close();
    }
  };

  run().catch((error) => {
    // 입력이 잘못됐으면 안내 문구만, 발송 중 실패는 원인을 볼 수 있게 전부 찍는다
    console.error(error instanceof NoticeInputError ? error.message : error);
    process.exit(1);
  });
};
