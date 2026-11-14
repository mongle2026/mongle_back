import { MigrationInterface, QueryRunner } from 'typeorm';

// user_sanction.acknowledged_at: 회원이 앱의 경고 안내 화면에서 확인을 누른 시각.
// 경고 1회를 받으면 앱을 열 때 이 값이 비어 있는 동안 안내 화면을 한 번 보여준다
export class AddUserSanctionAcknowledgedAt1793000000000 implements MigrationInterface {
  name = 'AddUserSanctionAcknowledgedAt1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const userSanction = await queryRunner.getTable('user_sanction');

    // 개발 DB는 synchronize로 이미 반영됐을 수 있다
    if (userSanction?.findColumnByName('acknowledged_at')) {
      return;
    }

    await queryRunner.query(
      'ALTER TABLE `user_sanction` ADD `acknowledged_at` DATETIME NULL AFTER `revoked_at`',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `user_sanction` DROP COLUMN `acknowledged_at`',
    );
  }
}
