import { MigrationInterface, QueryRunner } from 'typeorm';

// user.restricted_reason: 이용 제한 사유(ReportReason). 앱 제재 화면에 보여준다
export class AddUserRestrictedReason1792200000000 implements MigrationInterface {
  name = 'AddUserRestrictedReason1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 먼저 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const tableInfo = await queryRunner.getTable('user');

    if (tableInfo?.findColumnByName('restricted_reason')) {
      return;
    }

    await queryRunner.query(
      'ALTER TABLE `user` ADD `restricted_reason` VARCHAR(20) NULL AFTER `restricted_until`',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `user` DROP COLUMN `restricted_reason`',
    );
  }
}
