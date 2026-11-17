import { MigrationInterface, QueryRunner } from 'typeorm';

// 소식 알림을 눌렀을 때 여는 안내 화면(신고 검토 결과 · 운영정책 안내 · 이용 정지 해제 안내)에 쓰는 값.
// 신고 기록은 처리 후 며칠 안에 지워지지만 알림은 30일 · 제재 기록은 1년 남아서, 화면에 쓸 값을 복사해 둔다
// - notification.report_reason / reported_at: 신고한 사람에게 보내는 처리 결과 알림(report_resolved · report_rejected)의
//   신고 사유와 신고한 시각
// - notification.target_user_id / target_preview: 처리 결과 알림의 신고당한 회원과 신고 당시 내용 미리보기 (대상 카드)
// - notification.sanction_id: 운영정책 안내(policy_notice) · 이용 정지 해제 안내(restriction_expired)를 만든 제재(user_sanction.id).
//   GET /sanction/:sanctionId 로 상세(사유 · 정지 기간 · 경고 내역)를 받는다. 제재 기록이 지워져도 알림은 남아야 해서 FK 는 걸지 않는다
// - user_sanction.content_preview: 신고 당시 내용 미리보기 (운영정책 안내 화면의 대상 카드)
const COLUMNS = [
  {
    table: 'notification',
    column: 'report_reason',
    definition: 'VARCHAR(20) NULL',
    after: 'warning_count',
  },
  {
    table: 'notification',
    column: 'reported_at',
    definition: 'DATETIME NULL',
    after: 'report_reason',
  },
  {
    table: 'notification',
    column: 'sanction_id',
    definition: 'BIGINT NULL',
    after: 'reported_at',
  },
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

export class AddNotificationReportAndSanctionDetail1793500000000 implements MigrationInterface {
  name = 'AddNotificationReportAndSanctionDetail1793500000000';

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
