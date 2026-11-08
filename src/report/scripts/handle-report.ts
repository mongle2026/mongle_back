// src/report/scripts/handle-report.ts
// 디스코드에 온 신고를 번호로 처리한다. npm run report:handle -- <신고 번호> <처리 방법>
// DB · R2 · EXPO_ACCESS_TOKEN · 카카오 환경변수는 서버와 같아야 한다. (처리 알림 · 탈퇴 연결 끊기)
//
//   npm run report:handle -- 123 blind      피드 · 댓글 · 편지 가림 + 작성자 경고 1회
//   npm run report:handle -- 123 warn       회원 신고: 경고 1회
//   npm run report:handle -- 123 ban        경고 횟수와 관계없이 영구 정지 (글 신고면 글도 가림)
//   npm run report:handle -- 123 reject     운영정책 위반 없음
//   npm run report:handle -- 123 undo       처리 되돌리기 (가림 · 경고 · 정지를 없앤다. 알림은 보내지 않는다)
//   npm run report:handle -- 123 withdraw   영구 정지된 신고당한 회원 탈퇴 (되돌릴 수 없다. 재가입 막음)
//
// 경고 2회 누적은 7일 정지, 3회 누적은 영구 정지. 경고는 6개월 뒤 사라진다 (sanction/sanction.constants.ts)

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppDataSource } from '../../database/data-source';
import { StorageModule } from '../../storage/storage.module';
import { ReportModule } from '../report.module';
import {
  ReportHandleResult,
  ReportModerationService,
} from '../report-moderation.service';
import { ReportTargetType } from '../enums/report.enum';
import {
  SanctionNotice,
  SUSPENSION_DAYS,
} from '../sanction/sanction.constants';

const ACTION_LABELS = {
  blind: '가림 · 경고',
  warn: '경고',
  ban: '영구 정지',
  reject: '기각',
  undo: '되돌리기',
  withdraw: '탈퇴',
} as const;

type Action = keyof typeof ACTION_LABELS;

const USAGE = `사용법: npm run report:handle -- <신고 번호> <${Object.keys(ACTION_LABELS).join(' | ')}>`;

const TARGET_LABELS: Record<ReportTargetType, string> = {
  [ReportTargetType.FEED]: '피드',
  [ReportTargetType.COMMENT]: '댓글',
  [ReportTargetType.LETTER]: '편지',
  [ReportTargetType.USER]: '회원',
};

// AppModule 을 그대로 띄우면 크론까지 돌아서 서버와 겹친다. 신고 처리에 필요한 모듈만 띄운다.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    StorageModule,
    TypeOrmModule.forRoot({ ...AppDataSource.options, migrations: [] }),
    ReportModule,
  ],
})
class HandleReportModule {}

const parseArgs = () => {
  const [reportIdArg, actionArg] = process.argv.slice(2);
  const reportId = Number(reportIdArg);

  if (!Number.isInteger(reportId) || reportId <= 0 || !actionArg) {
    throw new Error(USAGE);
  }

  if (!(actionArg in ACTION_LABELS)) {
    throw new Error(`처리 방법을 알 수 없어요: ${actionArg}\n${USAGE}`);
  }

  return { reportId, action: actionArg as Action };
};

const formatKst = (date: Date) =>
  date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

const describeSanction = (result: ReportHandleResult) => {
  const { sanction } = result;

  if (!sanction) {
    return null;
  }

  const warnings =
    sanction.warningCount !== null
      ? `유효 경고 ${sanction.warningCount}회`
      : '경고와 관계없이';

  switch (sanction.notice) {
    case SanctionNotice.WARNING:
      return `  ${warnings} (이용 제한은 바뀌지 않았어요)`;
    case SanctionNotice.SUSPENSION:
      return `  ${warnings} → ${SUSPENSION_DAYS}일 이용 정지 (${formatKst(sanction.restrictedUntil!)} 까지)`;
    case SanctionNotice.PERMANENT:
      return `  ${warnings} → 영구 정지`;
  }
};

const describe = (
  reportId: number,
  action: Exclude<Action, 'withdraw'>,
  result: ReportHandleResult,
) => {
  const target = `${TARGET_LABELS[result.targetType]} #${result.targetId}`;
  const lines = [`신고 #${reportId} → ${target} ${ACTION_LABELS[action]}`];

  if (action === 'undo') {
    lines.push(
      result.isTargetChanged
        ? '  가림 · 경고 · 정지를 없앴어요. (그 사이 바뀐 이용 제한은 그대로 둬요)'
        : '  대상은 이미 풀려 있었어요.',
    );
    lines.push(`  처리 전으로 돌린 신고: ${result.reportCount}건`);
    return lines.join('\n');
  }

  const sanctionLine = describeSanction(result);

  if (sanctionLine) {
    lines.push(sanctionLine, '  신고당한 회원에게 운영정책 안내를 보냈어요.');
  } else if (action === 'blind' && !result.isTargetChanged) {
    lines.push(
      '  이미 가려졌거나 지워진 대상이라 경고 · 안내를 다시 보내지 않았어요.',
    );
  } else if (action === 'blind') {
    lines.push('  작성자가 탈퇴해서 가리기만 했어요.');
  } else if (action === 'ban') {
    lines.push('  이미 영구 정지된 회원이라 회원에게 다시 알리지 않았어요.');
  }

  lines.push(`  처리한 신고: ${result.reportCount}건 (신고한 회원에게 알림)`);

  return lines.join('\n');
};

async function handleReport() {
  const { reportId, action } = parseArgs();
  const app = await NestFactory.createApplicationContext(HandleReportModule, {
    logger: ['error', 'warn'],
  });

  try {
    const moderation = app.get(ReportModerationService);

    if (action === 'withdraw') {
      const { userId } = await moderation.withdraw(reportId);
      console.log(
        `신고 #${reportId} → 회원 #${userId} 탈퇴\n  같은 소셜 계정으로 다시 가입할 수 없어요. (banned_account)`,
      );
      return;
    }

    const result =
      action === 'blind'
        ? await moderation.blind(reportId)
        : action === 'warn'
          ? await moderation.warn(reportId)
          : action === 'ban'
            ? await moderation.ban(reportId)
            : action === 'reject'
              ? await moderation.reject(reportId)
              : await moderation.undo(reportId);

    console.log(describe(reportId, action, result));
  } finally {
    await app.close();
  }
}

handleReport().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
