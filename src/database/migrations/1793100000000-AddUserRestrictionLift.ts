import { MigrationInterface, QueryRunner } from 'typeorm';

// user.restriction_lift_reason: 기간이 끝나기 전에 이용 제한을 푼 이유 (이의 신청 받아들임 · 신고 처리 되돌림)
// user.restriction_lift_acknowledged_at: 회원이 앱의 이용 제한 해제 안내 화면에서 확인을 누른 마지막 시각.
// 이용 제한이 풀리면 앱에 처음 들어올 때 해제 안내 화면을 한 번 보여준다
export class AddUserRestrictionLift1793100000000 implements MigrationInterface {
  name = 'AddUserRestrictionLift1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const user = await queryRunner.getTable('user');

    // 개발 DB는 synchronize로 이미 반영됐을 수 있다
    if (!user?.findColumnByName('restriction_lift_reason')) {
      await queryRunner.query(
        'ALTER TABLE `user` ADD `restriction_lift_reason` VARCHAR(20) NULL AFTER `restricted_reason`',
      );
    }

    if (!user?.findColumnByName('restriction_lift_acknowledged_at')) {
      await queryRunner.query(
        'ALTER TABLE `user` ADD `restriction_lift_acknowledged_at` DATETIME NULL AFTER `restriction_lift_reason`',
      );
    }

    // 이 기능 전에 이미 기간이 끝난 제한은 안내하지 않는다
    await queryRunner.query(
      'UPDATE `user` SET `restriction_lift_acknowledged_at` = NOW() ' +
        'WHERE `restricted_at` IS NOT NULL AND `restricted_until` <= NOW() ' +
        'AND `restriction_lift_acknowledged_at` IS NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `user` DROP COLUMN `restriction_lift_acknowledged_at`',
    );
    await queryRunner.query(
      'ALTER TABLE `user` DROP COLUMN `restriction_lift_reason`',
    );
  }
}
