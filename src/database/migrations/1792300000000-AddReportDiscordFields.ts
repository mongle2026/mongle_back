import { MigrationInterface, QueryRunner } from 'typeorm';

// 디스코드 봇으로 신고를 처리할 때 쓰는 컬럼
// - report.handled_by: 처리한 운영자의 디스코드 사용자 id. 터미널(npm run report:handle)로 처리했으면 null
// - report.discord_message_id: 신고 알림 메시지 id. 처리하면 이 메시지를 고친다. 웹훅으로 보낸 예전 신고는 null
const COLUMNS = [
  {
    table: 'report',
    column: 'handled_by',
    definition: 'VARCHAR(32) NULL',
    after: 'handled_at',
  },
  {
    table: 'report',
    column: 'discord_message_id',
    definition: 'VARCHAR(32) NULL',
    after: 'handled_by',
  },
];

export class AddReportDiscordFields1792300000000 implements MigrationInterface {
  name = 'AddReportDiscordFields1792300000000';

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
      await queryRunner.query(
        `ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``,
      );
    }
  }
}
