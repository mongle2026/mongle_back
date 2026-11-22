import { MigrationInterface, QueryRunner } from 'typeorm';

// 공지(system) · 이벤트(event) 알림 제목. 보낼 때마다 제목 · 내용이 달라서 알림에 복사해 둔다. 내용은 content 에 둔다.
// 아침으로 미룬 푸시와 알림 목록이 같은 문구를 보여주려고 저장한다. 예전 공지 · 이벤트, 다른 알림은 null
const COLUMNS = [
  {
    table: 'notification',
    column: 'notice_title',
    definition: 'VARCHAR(100) NULL',
    after: 'content',
  },
];

export class AddNotificationNoticeTitle1793800000000 implements MigrationInterface {
  name = 'AddNotificationNoticeTitle1793800000000';

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
