import { MigrationInterface, QueryRunner } from 'typeorm';

// 운영 처리용 컬럼. 관리 화면이 없어서 운영자가 DB 에서 직접 채운다.
// - feed / feed_comment / letter.blinded_at: 신고를 확인하고 가린 시각
// - user.restricted_at: 이용을 제한한 시각
const COLUMNS = [
  { table: 'feed', column: 'blinded_at', after: 'profile_hidden' },
  { table: 'feed_comment', column: 'blinded_at', after: 'updated_at' },
  { table: 'letter', column: 'blinded_at', after: 'receiver_deleted_at' },
  { table: 'user', column: 'restricted_at', after: 'withdrawn_at' },
];

export class AddBlindedAtAndUserRestrictedAt1792000000000 implements MigrationInterface {
  name = 'AddBlindedAtAndUserRestrictedAt1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, column, after } of COLUMNS) {
      // 개발 DB는 synchronize로 먼저 반영됐을 수 있어서 존재 여부를 확인하고 진행
      const tableInfo = await queryRunner.getTable(table);

      if (tableInfo?.findColumnByName(column)) {
        continue;
      }

      await queryRunner.query(
        `ALTER TABLE \`${table}\` ADD \`${column}\` DATETIME NULL AFTER \`${after}\``,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table, column } of [...COLUMNS].reverse()) {
      await queryRunner.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
    }
  }
}
