import { MigrationInterface, QueryRunner } from 'typeorm';

// 신고 경고 누적 제재
// - user_sanction: 경고 · 영구 정지 이력. 유효한 경고(6개월 안, 되돌리지 않음) 수로 7일 정지 · 영구 정지를 정한다
// - banned_account: 영구 정지로 탈퇴시킨 소셜 계정. 같은 소셜 계정으로 다시 가입하지 못하게 막는다
// - notification.sanction / warning_count: 운영정책 안내에 붙는 제재 내용과 그때의 유효한 경고 수
const NOTIFICATION_COLUMNS = [
  {
    column: 'sanction',
    definition: 'VARCHAR(20) NULL',
    after: 'target_type',
  },
  {
    column: 'warning_count',
    definition: 'TINYINT UNSIGNED NULL',
    after: 'sanction',
  },
];

export class CreateUserSanctionAndBannedAccount1792500000000 implements MigrationInterface {
  name = 'CreateUserSanctionAndBannedAccount1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    if (!(await queryRunner.hasTable('user_sanction'))) {
      await queryRunner.query(
        `CREATE TABLE \`user_sanction\` (
          \`id\` BIGINT NOT NULL AUTO_INCREMENT,
          \`user_id\` BIGINT NOT NULL,
          \`type\` VARCHAR(20) NOT NULL,
          \`report_id\` BIGINT NOT NULL,
          \`target_type\` VARCHAR(20) NOT NULL,
          \`target_id\` BIGINT NOT NULL,
          \`reason\` VARCHAR(20) NOT NULL,
          \`expires_at\` DATETIME NULL,
          \`restriction\` VARCHAR(20) NULL,
          \`restricted_at\` DATETIME NULL,
          \`restricted_until\` DATETIME NULL,
          \`prev_restricted_at\` DATETIME NULL,
          \`prev_restricted_until\` DATETIME NULL,
          \`prev_restricted_reason\` VARCHAR(20) NULL,
          \`handled_by\` VARCHAR(32) NULL,
          \`revoked_at\` DATETIME NULL,
          \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`IDX_user_sanction_user_type_expires_at\` (\`user_id\`, \`type\`, \`expires_at\`),
          INDEX \`IDX_user_sanction_target\` (\`target_type\`, \`target_id\`),
          CONSTRAINT \`FK_user_sanction_user_id\` FOREIGN KEY (\`user_id\`)
            REFERENCES \`user\` (\`id\`)
        ) ENGINE=InnoDB`,
      );
    }

    if (!(await queryRunner.hasTable('banned_account'))) {
      await queryRunner.query(
        `CREATE TABLE \`banned_account\` (
          \`id\` BIGINT NOT NULL AUTO_INCREMENT,
          \`provider\` VARCHAR(10) NOT NULL,
          \`provider_user_id\` VARCHAR(100) NOT NULL,
          \`user_id\` BIGINT NOT NULL,
          \`reason\` VARCHAR(20) NULL,
          \`banned_by\` VARCHAR(32) NULL,
          \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`UQ_banned_account_provider_user_id\` (\`provider\`, \`provider_user_id\`),
          CONSTRAINT \`FK_banned_account_user_id\` FOREIGN KEY (\`user_id\`)
            REFERENCES \`user\` (\`id\`)
        ) ENGINE=InnoDB`,
      );
    }

    const notification = await queryRunner.getTable('notification');

    for (const { column, definition, after } of NOTIFICATION_COLUMNS) {
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

    await queryRunner.query('DROP TABLE `banned_account`');
    await queryRunner.query('DROP TABLE `user_sanction`');
  }
}
