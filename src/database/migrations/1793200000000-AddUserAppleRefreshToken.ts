import { MigrationInterface, QueryRunner } from 'typeorm';

// user.apple_refresh_token: 애플 로그인 · 가입 때 받은 애플 refresh token 을 암호화한 값.
// 운영자가 영구 정지된 회원을 탈퇴시킬 때도 애플 연결을 끊을 수 있도록 미리 받아 둔다
export class AddUserAppleRefreshToken1793200000000 implements MigrationInterface {
  name = 'AddUserAppleRefreshToken1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const user = await queryRunner.getTable('user');

    // 개발 DB는 synchronize로 이미 반영됐을 수 있다
    if (user?.findColumnByName('apple_refresh_token')) {
      return;
    }

    await queryRunner.query(
      'ALTER TABLE `user` ADD `apple_refresh_token` VARCHAR(1000) NULL AFTER `refresh_token_hash`',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `user` DROP COLUMN `apple_refresh_token`',
    );
  }
}
