import { MigrationInterface, QueryRunner } from 'typeorm';

// 탈퇴한 회원의 소셜 계정 연결 끊기가 실패했을 때 다시 시도하려고 담아 두는 표.
// 재시도 크론이 next_attempt_at 이 지난 행을 보고 다시 끊는다.
export class CreateSocialUnlinkPending1791200000000 implements MigrationInterface {
  name = 'CreateSocialUnlinkPending1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const hasTable = await queryRunner.hasTable('social_unlink_pending');

    if (hasTable) {
      return;
    }

    await queryRunner.query(
      `CREATE TABLE \`social_unlink_pending\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT,
        \`provider\` VARCHAR(10) NOT NULL,
        \`provider_user_id\` VARCHAR(100) NOT NULL,
        \`apple_refresh_token\` VARCHAR(1000) NULL,
        \`attempts\` INT NOT NULL DEFAULT 0,
        \`next_attempt_at\` DATETIME NOT NULL,
        \`last_error\` VARCHAR(500) NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_social_unlink_pending_next_attempt_at\` (\`next_attempt_at\`)
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`social_unlink_pending\``);
  }
}
