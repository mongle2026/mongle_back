import { MigrationInterface, QueryRunner } from 'typeorm';

// notification.event_title 을 지운다.
// 이벤트 알림을 만드는 코드가 없어서 값이 들어간 적이 없고, 이벤트 알림은 이제 제목 · 내용을 notice_title · content 에 저장한다.
// 서버가 엔티티의 모든 컬럼을 읽어서, event_title 을 뺀 서버를 먼저 배포한 뒤에 실행한다
export class DropNotificationEventTitle1793900000000 implements MigrationInterface {
  name = 'DropNotificationEventTitle1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const notification = await queryRunner.getTable('notification');

    // 개발 DB는 synchronize로 이미 지워졌을 수 있다
    if (!notification?.findColumnByName('event_title')) {
      return;
    }

    await queryRunner.query(
      'ALTER TABLE `notification` DROP COLUMN `event_title`',
    );
  }

  // 처음에는 content 바로 뒤에 있었는데, 그 자리에 notice_title 이 들어가서 그 뒤에 만든다
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `notification` ADD `event_title` VARCHAR(100) NULL AFTER `notice_title`',
    );
  }
}
