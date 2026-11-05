import { MigrationInterface, QueryRunner } from 'typeorm';

// 신고 처리(npm run report:handle)에 쓰는 컬럼
// - user.restricted_until: 이용 제한이 끝나는 시각. restricted_at 이 있는데 null 이면 영구 제한
// - report.action / handled_at: 어떻게, 언제 처리했는지
// - notification.target_type: 신고 처리 알림 문구에 들어가는 대상 종류 (피드 / 댓글 / 편지 / 회원)
const COLUMNS = [
  {
    table: 'user',
    column: 'restricted_until',
    definition: 'DATETIME NULL',
    after: 'restricted_at',
  },
  {
    table: 'report',
    column: 'action',
    definition: 'VARCHAR(20) NULL',
    after: 'status',
  },
  {
    table: 'report',
    column: 'handled_at',
    definition: 'DATETIME NULL',
    after: 'action',
  },
  {
    table: 'notification',
    column: 'target_type',
    definition: 'VARCHAR(20) NULL',
    after: 'event_title',
  },
];

export class AddReportHandlingAndRestrictionPeriod1792100000000 implements MigrationInterface {
  name = 'AddReportHandlingAndRestrictionPeriod1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, column, definition, after } of COLUMNS) {
      // 개발 DB는 synchronize로 먼저 반영됐을 수 있어서 존재 여부를 확인하고 진행
      const tableInfo = await queryRunner.getTable(table);

      if (tableInfo?.findColumnByName(column)) {
        continue;
      }

      await queryRunner.query(
        `ALTER TABLE \`${table}\` ADD \`${column}\` ${definition} AFTER \`${after}\``,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table, column } of [...COLUMNS].reverse()) {
      await queryRunner.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
    }
  }
}
