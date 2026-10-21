import { MigrationInterface, QueryRunner } from 'typeorm';

// 야간 알림을 끈 사람에게 밤에 생긴 알림의 푸시를 아침으로 미루는 표시. 기존 알림은 모두 0 으로 둔다.
export class AddNotificationPushPending1790800000000 implements MigrationInterface {
  name = 'AddNotificationPushPending1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 먼저 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('notification');

    if (!table?.findColumnByName('push_pending')) {
      await queryRunner.query(
        `ALTER TABLE \`notification\` ADD COLUMN \`push_pending\` TINYINT NOT NULL DEFAULT 0`,
      );
    }

    if (
      !table?.indices.some(
        (index) => index.name === 'idx_notification_push_pending',
      )
    ) {
      await queryRunner.query(
        `CREATE INDEX \`idx_notification_push_pending\` ON \`notification\` (\`push_pending\`, \`user_id\`)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`idx_notification_push_pending\` ON \`notification\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`notification\` DROP COLUMN \`push_pending\``,
    );
  }
}
