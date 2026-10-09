import { MigrationInterface, QueryRunner } from 'typeorm';

// 카카오 로그인: 발급한 refresh token 의 해시를 저장해서 갱신/로그아웃 시 확인한다.
export class AddUserRefreshTokenHash1790300000000 implements MigrationInterface {
  name = 'AddUserRefreshTokenHash1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('user');

    if (!table?.findColumnByName('refresh_token_hash')) {
      await queryRunner.query(
        `ALTER TABLE \`user\` ADD COLUMN \`refresh_token_hash\` VARCHAR(64) NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`user\` DROP COLUMN \`refresh_token_hash\``,
    );
  }
}
