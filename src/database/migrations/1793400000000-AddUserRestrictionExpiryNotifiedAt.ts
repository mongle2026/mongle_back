import { MigrationInterface, QueryRunner } from 'typeorm';

// user.restriction_expiry_notified_at: 이용 정지 기간이 끝나서 '이용 정지 해제 안내' 알림을 보낸 마지막 시각.
// restricted_until 보다 이르거나 null 이면 아직 이번 정지의 해제 안내를 보내지 않았다
// IDX_user_restricted_until: 해제 안내 크론이 매분 최근에 끝난 정지만 찾는다
export class AddUserRestrictionExpiryNotifiedAt1793400000000 implements MigrationInterface {
  name = 'AddUserRestrictionExpiryNotifiedAt1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const user = await queryRunner.getTable('user');

    // 개발 DB는 synchronize로 이미 반영됐을 수 있다
    if (!user?.findColumnByName('restriction_expiry_notified_at')) {
      await queryRunner.query(
        'ALTER TABLE `user` ADD `restriction_expiry_notified_at` DATETIME NULL AFTER `restriction_lift_acknowledged_at`',
      );
    }

    if (
      !user?.indices.some((index) => index.name === 'IDX_user_restricted_until')
    ) {
      await queryRunner.query(
        'CREATE INDEX `IDX_user_restricted_until` ON `user` (`restricted_until`)',
      );
    }

    // 이 기능 전에 이미 기간이 끝난 정지는 알림을 보내지 않는다
    await queryRunner.query(
      'UPDATE `user` SET `restriction_expiry_notified_at` = NOW() ' +
        'WHERE `restricted_at` IS NOT NULL AND `restricted_until` <= NOW() ' +
        'AND `restriction_expiry_notified_at` IS NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `IDX_user_restricted_until` ON `user`');
    await queryRunner.query(
      'ALTER TABLE `user` DROP COLUMN `restriction_expiry_notified_at`',
    );
  }
}
