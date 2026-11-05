import { MigrationInterface, QueryRunner } from 'typeorm';

// 이용 제한 이의 신청. 한 제한(user_id + restricted_at)에 검토 중인 신청은 하나만 둔다 (서비스에서 확인). 기각되면 다시 낼 수 있다.
export class CreateRestrictionAppeal1792400000000 implements MigrationInterface {
  name = 'CreateRestrictionAppeal1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const hasTable = await queryRunner.hasTable('restriction_appeal');

    if (hasTable) {
      return;
    }

    await queryRunner.query(
      `CREATE TABLE \`restriction_appeal\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT NOT NULL,
        \`restricted_at\` DATETIME NOT NULL,
        \`restricted_until\` DATETIME NULL,
        \`restricted_reason\` VARCHAR(20) NULL,
        \`content\` VARCHAR(500) NOT NULL,
        \`status\` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        \`handled_at\` DATETIME NULL,
        \`handled_by\` VARCHAR(32) NULL,
        \`discord_message_id\` VARCHAR(32) NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_restriction_appeal_user_restricted_at\` (\`user_id\`, \`restricted_at\`),
        INDEX \`IDX_restriction_appeal_status_created_at\` (\`status\`, \`created_at\`),
        CONSTRAINT \`FK_restriction_appeal_user_id\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`user\` (\`id\`)
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`restriction_appeal\``);
  }
}
