import { MigrationInterface, QueryRunner } from 'typeorm';

// 프로필 노래 커버 그리드에서 뺀 글 표시. 기존 글은 모두 프로필에 보이도록 0 으로 둔다.
export class AddFeedProfileHidden1790700000000 implements MigrationInterface {
  name = 'AddFeedProfileHidden1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 컬럼만 먼저 생겼을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('feed');

    if (!table?.findColumnByName('profile_hidden')) {
      await queryRunner.query(
        `ALTER TABLE \`feed\` ADD COLUMN \`profile_hidden\` TINYINT NOT NULL DEFAULT 0`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`feed\` DROP COLUMN \`profile_hidden\``);
  }
}
