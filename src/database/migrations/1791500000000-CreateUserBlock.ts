import { MigrationInterface, QueryRunner } from 'typeorm';

// 회원 차단. 한쪽이 차단하면 서로의 글 · 댓글 · 편지 · 알림이 보이지 않는다.
// 회원이 지워지면 차단도 함께 지운다.
export class CreateUserBlock1791500000000 implements MigrationInterface {
  name = 'CreateUserBlock1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const hasTable = await queryRunner.hasTable('user_block');

    if (hasTable) {
      return;
    }

    await queryRunner.query(
      `CREATE TABLE \`user_block\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT,
        \`blocker_id\` BIGINT NOT NULL,
        \`blocked_id\` BIGINT NOT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_user_block_blocker_blocked\` (\`blocker_id\`, \`blocked_id\`),
        INDEX \`IDX_user_block_blocked_id\` (\`blocked_id\`),
        CONSTRAINT \`FK_user_block_blocker_id\` FOREIGN KEY (\`blocker_id\`)
          REFERENCES \`user\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_user_block_blocked_id\` FOREIGN KEY (\`blocked_id\`)
          REFERENCES \`user\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`user_block\``);
  }
}
