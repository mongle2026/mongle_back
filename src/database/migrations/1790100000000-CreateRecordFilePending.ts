import { MigrationInterface, QueryRunner } from 'typeorm';

// 아직 레코드에 붙지 않았거나, 레코드에서 떨어져 나와 지워야 하는 R2 객체를 담는 표.
// 정리 크론이 purge_after가 지난 행을 보고 R2에서 객체를 지운다.
export class CreateRecordFilePending1790100000000 implements MigrationInterface {
  name = 'CreateRecordFilePending1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const hasTable = await queryRunner.hasTable('record_file_pending');

    if (hasTable) {
      return;
    }

    await queryRunner.query(
      `CREATE TABLE \`record_file_pending\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT NOT NULL,
        \`file_key\` VARCHAR(500) NOT NULL,
        \`mime_type\` VARCHAR(50) NOT NULL,
        \`purge_after\` DATETIME NOT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_record_file_pending_file_key\` (\`file_key\`),
        INDEX \`IDX_record_file_pending_purge_after\` (\`purge_after\`)
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`record_file_pending\``);
  }
}
