import { MigrationInterface, QueryRunner } from 'typeorm';

// 회원 가입일시 user.created_at.
// 이전에 가입한 회원은 정확한 시각이 남아 있지 않아서 모두 2026-11-10 00:00(KST) = 2026-11-09 15:00(UTC)로 넣는다.
// 그 뒤로 가입하는 회원은 가입 시각이 그대로 들어간다.
//
// 개발 DB 에서 이 마이그레이션보다 먼저 synchronize 로 칸이 생겼으면, 이전 회원에는 서버를 켠 시각이 들어가 있다.
// 그때는 칸을 다시 만들지 않고 그대로 둔다 (개발 데이터라 정확한 값이 필요 없다)
const LEGACY_SIGNUP_AT_UTC = '2026-11-09 15:00:00';

export class AddUserCreatedAt1792900000000 implements MigrationInterface {
  name = 'AddUserCreatedAt1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const user = await queryRunner.getTable('user');

    if (user?.findColumnByName('created_at')) {
      return;
    }

    // 1. 비워 둔 채로 추가 → 2. 기존 회원 채우기 → 3. 새 회원은 가입 시각이 기본값
    await queryRunner.query(
      'ALTER TABLE `user` ADD `created_at` DATETIME(6) NULL AFTER `email`',
    );
    await queryRunner.query(
      'UPDATE `user` SET `created_at` = ? WHERE `created_at` IS NULL',
      [LEGACY_SIGNUP_AT_UTC],
    );
    await queryRunner.query(
      'ALTER TABLE `user` MODIFY `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `created_at`');
  }
}
