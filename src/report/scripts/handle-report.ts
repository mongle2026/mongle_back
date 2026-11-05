// src/report/scripts/handle-report.ts
// 디스코드에 온 신고를 번호로 처리한다. npm run report:handle -- <신고 번호> <처리 방법> [기간]
// DB · R2 · EXPO_ACCESS_TOKEN 환경변수는 서버와 같아야 한다. (처리 알림을 보낸다)
//
//   npm run report:handle -- 123 blind              피드 · 댓글 · 편지 가림
//   npm run report:handle -- 123 restrict 7         회원 이용 제한 (3 | 7 | 30 | permanent)
//   npm run report:handle -- 123 reject             운영정책 위반 없음
//   npm run report:handle -- 123 undo               처리 되돌리기 (알림은 보내지 않는다)

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
import {
  RESTRICTION_DAYS,
  ReportTargetType,
  RestrictionPeriod,
} from '../enums/report.enum';

const USAGE = `사용법: npm run report:handle -- <신고 번호> <blind | restrict | reject | undo> [기간]
  restrict 기간: ${RESTRICTION_DAYS.join(' | ')} | permanent`;

const TARGET_LABELS: Record<ReportTargetType, string> = {
  [ReportTargetType.FEED]: '피드',
  [ReportTargetType.COMMENT]: '댓글',
  [ReportTargetType.LETTER]: '편지',
  [ReportTargetType.USER]: '회원',
};

const ACTION_LABELS = {
  blind: '가림',
  restrict: '이용 제한',
  reject: '기각',
  undo: '되돌리기',
} as const;

type Action = keyof typeof ACTION_LABELS;

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
  const [reportIdArg, actionArg, periodArg] = process.argv.slice(2);
  const reportId = Number(reportIdArg);

  if (!Number.isInteger(reportId) || reportId <= 0 || !actionArg) {
    throw new Error(USAGE);
  }

  if (!(actionArg in ACTION_LABELS)) {
    throw new Error(`처리 방법을 알 수 없어요: ${actionArg}\n${USAGE}`);
  }

  const action = actionArg as Action;

  if (action !== 'restrict') {
    return { reportId, action, period: null };
  }

  const period: RestrictionPeriod | null =
    periodArg === 'permanent'
      ? 'permanent'
      : (RESTRICTION_DAYS.find((days) => String(days) === periodArg) ?? null);

  if (!period) {
    throw new Error(`이용 제한 기간을 정해 주세요.\n${USAGE}`);
  }

  return { reportId, action, period };
};

const formatKst = (date: Date) =>
  date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

const describe = (
  reportId: number,
  action: Action,
  result: ReportHandleResult,
) => {
  const target = `${TARGET_LABELS[result.targetType]} #${result.targetId}`;
  const lines = [`신고 #${reportId} → ${target} ${ACTION_LABELS[action]}`];

  if (action === 'restrict') {
    lines.push(
      `  기간: ${result.restrictedUntil ? `${formatKst(result.restrictedUntil)} 까지` : '영구'}`,
    );
  }

  if (action === 'undo') {
    lines.push(
      result.isTargetChanged
        ? '  가림 · 이용 제한을 풀었어요.'
        : '  대상은 이미 풀려 있었어요.',
    );
    lines.push(`  처리 전으로 돌린 신고: ${result.reportCount}건`);
    return lines.join('\n');
  }

  if (action !== 'reject' && !result.isTargetChanged) {
    lines.push(
      action === 'restrict'
        ? '  이미 제한 중이라 기간만 바꿨어요. 회원에게 다시 알리지 않았어요.'
        : '  이미 가려졌거나 지워진 대상이라 작성자에게 다시 알리지 않았어요.',
    );
  }

  lines.push(`  처리한 신고: ${result.reportCount}건 (신고한 회원에게 알림)`);

  return lines.join('\n');
};

async function handleReport() {
  const { reportId, action, period } = parseArgs();
  const app = await NestFactory.createApplicationContext(HandleReportModule, {
    logger: ['error', 'warn'],
  });

  try {
    const moderation = app.get(ReportModerationService);
    const result =
      action === 'blind'
        ? await moderation.blind(reportId)
        : action === 'restrict'
          ? await moderation.restrict(reportId, period)
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
