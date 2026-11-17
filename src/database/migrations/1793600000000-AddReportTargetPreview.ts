import { MigrationInterface, QueryRunner } from 'typeorm';

// 신고 검토 결과 · 운영정책 안내 화면의 대상 카드에 쓰는 값.
// 신고 기록은 처리 후 며칠 안에 지워지지만 알림은 30일 · 제재 기록은 1년 남아서, 화면에 쓸 값을 복사해 둔다
// - notification.target_user_id / target_preview: 처리 결과 알림(report_resolved · report_rejected)의
//   신고당한 회원과 신고 당시 내용 미리보기. 회원이 지워져도 알림은 남아야 해서 FK 는 걸지 않는다
// - user_sanction.content_preview: 신고 당시 내용 미리보기 (운영정책 안내 화면의 대상 카드)
const COLUMNS = [
  {
    table: 'notification',
    column: 'target_user_id',
    definition: 'BIGINT NULL',
    after: 'sanction_id',
  },
  {
    table: 'notification',
    column: 'target_preview',
    definition: 'VARCHAR(100) NULL',
    after: 'target_user_id',
  },
  {
    table: 'user_sanction',
    column: 'content_preview',
    definition: 'VARCHAR(100) NULL',
    after: 'reason',
  },
];

export class AddReportTargetPreview1793600000000 implements MigrationInterface {
  name = 'AddReportTargetPreview1793600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, column, definition, after } of COLUMNS) {
      // 개발 DB는 synchronize로 이미 반영됐을 수 있다
      const current = await queryRunner.getTable(table);

      if (current?.findColumnByName(column)) {
        continue;
      }

      await queryRunner.query(
        `ALTER TABLE \`${table}\` ADD \`${column}\` ${definition} AFTER \`${after}\``,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table, column } of [...COLUMNS].reverse()) {
      await queryRunner.query(
        `ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``,
      );
    }
  }
}
