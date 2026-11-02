import { MigrationInterface, QueryRunner } from 'typeorm';

// 알림 화면을 마지막으로 나갈 때 와 있던 가장 큰 알림 id. 이보다 큰 알림이 있으면 종 아이콘에 레드닷을 띄운다
export class AddUserNotificationCheckedId1791800000000 implements MigrationInterface {
  name = 'AddUserNotificationCheckedId1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 먼저 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('user');

    // 운영 전이라 이미 가입한 회원도 0 으로 둔다 (최근 30일 알림이 있으면 레드닷이 뜬다)
    if (!table?.findColumnByName('notification_checked_id')) {
      await queryRunner.query(
        `ALTER TABLE \`user\` ADD \`notification_checked_id\` BIGINT NOT NULL DEFAULT 0 AFTER \`default_profile_image_no\``,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`user\` DROP COLUMN \`notification_checked_id\``,
    );
  }
}
