// src/notification/scripts/send-system-notice.ts
// 공지(시스템 알림)를 모든 회원과 로그인하지 않은 기기에 보낸다. npm run notify:system
// DB · R2 · EXPO_ACCESS_TOKEN 환경변수는 서버와 같아야 한다.

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppDataSource } from '../../database/data-source';
import { StorageModule } from '../../storage/storage.module';
import { NotificationModule } from '../notification.module';
import { NotificationService } from '../notification.service';

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

async function sendSystemNotice() {
  const app = await NestFactory.createApplicationContext(
    SendSystemNoticeModule,
  );

  try {
    const { memberCount, guestTokenCount } = await app
      .get(NotificationService)
      .broadcastSystemNotice();

    console.log(
      `공지 발송 완료: 회원 ${memberCount}명, 로그인하지 않은 기기 ${guestTokenCount}대`,
    );
  } finally {
    await app.close();
  }
}

sendSystemNotice().catch((error) => {
  console.error(error);
  process.exit(1);
});
