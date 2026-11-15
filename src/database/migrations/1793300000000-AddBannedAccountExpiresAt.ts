import { MigrationInterface, QueryRunner } from 'typeorm';

// banned_account.expires_at: 다시 가입할 수 있게 되는 시각 (개인정보처리방침의 재가입 제한 정보 보관 기간).
// 지금까지 남긴 행은 모두 운영자가 영구 정지된 회원을 탈퇴시킨 것이라 남긴 날부터 1년으로 채운다.
// 이 시각이 지나면 보관 기간 정리 크론이 행을 지운다
export class AddBannedAccountExpiresAt1793300000000 implements MigrationInterface {
  name = 'AddBannedAccountExpiresAt1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('banned_account');

    // 개발 DB는 synchronize로 컬럼 · 인덱스가 이미 생겼을 수 있다. 그래도 비어 있는 값은 채운다
    if (!table?.findColumnByName('expires_at')) {
      await queryRunner.query(
        'ALTER TABLE `banned_account` ADD `expires_at` DATETIME NULL AFTER `banned_by`',
      );
    }

    if (
      !table?.indices.some(
        (index) => index.name === 'IDX_banned_account_expires_at',
      )
    ) {
      await queryRunner.query(
        'CREATE INDEX `IDX_banned_account_expires_at` ON `banned_account` (`expires_at`)',
      );
    }

    await queryRunner.query(
      'UPDATE `banned_account` SET `expires_at` = DATE_ADD(`created_at`, INTERVAL 12 MONTH) WHERE `expires_at` IS NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX `IDX_banned_account_expires_at` ON `banned_account`',
    );
    await queryRunner.query(
      'ALTER TABLE `banned_account` DROP COLUMN `expires_at`',
    );
  }
}
