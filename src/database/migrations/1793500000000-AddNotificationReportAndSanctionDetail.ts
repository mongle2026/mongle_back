import { MigrationInterface, QueryRunner } from 'typeorm';

// 소식 알림을 눌렀을 때 여는 안내 화면(신고 검토 결과 · 운영정책 안내 · 이용 정지 해제 안내)에 쓰는 값
// - notification.report_reason / reported_at: 신고한 사람에게 보내는 처리 결과 알림(report_resolved · report_rejected)의
//   신고 사유와 신고한 시각. 신고 기록은 처리 후 며칠 안에 지워지지만 알림은 30일 남아서 알림에 복사해 둔다
// - notification.sanction_id: 운영정책 안내(policy_notice) · 이용 정지 해제 안내(restriction_expired)를 만든 제재(user_sanction.id).
//   GET /sanction/:sanctionId 로 상세(사유 · 정지 기간 · 경고 내역)를 받는다. 제재 기록이 지워져도 알림은 남아야 해서 FK 는 걸지 않는다
const NOTIFICATION_COLUMNS = [
  {
    column: 'report_reason',
    definition: 'VARCHAR(20) NULL',
    after: 'warning_count',
  },
  {
    column: 'reported_at',
    definition: 'DATETIME NULL',
    after: 'report_reason',
  },
  {
    column: 'sanction_id',
    definition: 'BIGINT NULL',
    after: 'reported_at',
  },
];

export class AddNotificationReportAndSanctionDetail1793500000000 implements MigrationInterface {
  name = 'AddNotificationReportAndSanctionDetail1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const notification = await queryRunner.getTable('notification');

    for (const { column, definition, after } of NOTIFICATION_COLUMNS) {
      // 개발 DB는 synchronize로 이미 반영됐을 수 있다
      if (notification?.findColumnByName(column)) {
        continue;
      }

      await queryRunner.query(
        `ALTER TABLE \`notification\` ADD \`${column}\` ${definition} AFTER \`${after}\``,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { column } of [...NOTIFICATION_COLUMNS].reverse()) {
      await queryRunner.query(
        `ALTER TABLE \`notification\` DROP COLUMN \`${column}\``,
      );
    }
  }
}
