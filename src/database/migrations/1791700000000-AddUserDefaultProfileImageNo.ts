import { MigrationInterface, QueryRunner } from 'typeorm';

// 회원마다 기본 프로필 사진 번호(1~5)를 둔다. 사진 파일은 모두 함께 쓴다(R2 defaults/profile_{번호}.png)
export class AddUserDefaultProfileImageNo1791700000000 implements MigrationInterface {
  name = 'AddUserDefaultProfileImageNo1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 먼저 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('user');

    if (!table?.findColumnByName('default_profile_image_no')) {
      await queryRunner.query(
        `ALTER TABLE \`user\` ADD \`default_profile_image_no\` TINYINT UNSIGNED NULL AFTER \`profile_image_key\``,
      );
    }

    // 이미 가입한 회원은 랜덤으로 정한다. 탈퇴한 회원은 null 로 둔다
    await queryRunner.query(
      `UPDATE \`user\` SET \`default_profile_image_no\` = FLOOR(1 + RAND() * 5) WHERE \`withdrawn_at\` IS NULL AND \`default_profile_image_no\` IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`user\` DROP COLUMN \`default_profile_image_no\``,
    );
  }
}
