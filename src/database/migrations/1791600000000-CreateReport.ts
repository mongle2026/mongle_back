import { MigrationInterface, QueryRunner } from 'typeorm';

// 신고. 대상(target_type + target_id)은 글이 지워진 뒤에도 남아야 해서 FK 를 걸지 않는다.
// 같은 사람이 같은 대상을 두 번 신고할 수 없다.
export class CreateReport1791600000000 implements MigrationInterface {
  name = 'CreateReport1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const hasTable = await queryRunner.hasTable('report');

    if (hasTable) {
      return;
    }

    await queryRunner.query(
      `CREATE TABLE \`report\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT,
        \`reporter_id\` BIGINT NOT NULL,
        \`reported_user_id\` BIGINT NOT NULL,
        \`target_type\` VARCHAR(20) NOT NULL,
        \`target_id\` BIGINT NOT NULL,
        \`reason\` VARCHAR(20) NOT NULL,
        \`detail\` VARCHAR(500) NULL,
        \`content_snapshot\` JSON NOT NULL,
        \`status\` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_report_reporter_target\` (\`reporter_id\`, \`target_type\`, \`target_id\`),
        INDEX \`IDX_report_target\` (\`target_type\`, \`target_id\`),
        INDEX \`IDX_report_reported_user_id\` (\`reported_user_id\`),
        INDEX \`IDX_report_status_created_at\` (\`status\`, \`created_at\`),
        CONSTRAINT \`FK_report_reporter_id\` FOREIGN KEY (\`reporter_id\`)
          REFERENCES \`user\` (\`id\`),
        CONSTRAINT \`FK_report_reported_user_id\` FOREIGN KEY (\`reported_user_id\`)
          REFERENCES \`user\` (\`id\`)
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`report\``);
  }
}
