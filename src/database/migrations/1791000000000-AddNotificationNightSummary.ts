import { MigrationInterface, QueryRunner } from 'typeorm';

// 야간 알림을 끈 사람에게 밤사이 쌓인 알림을 아침에 'n개 알림' 한 줄로 묶어 보여준다.
// hidden_in_list: 묶음에 들어가서 목록에 따로 보이지 않는 알림, summary_count: 묶음 한 줄의 알림 개수
// 아직 푸시를 미뤄둔 기존 알림은 아침에 묶이도록 숨겨둔다.
export class AddNotificationNightSummary1791000000000 implements MigrationInterface {
  name = 'AddNotificationNightSummary1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 먼저 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('notification');

    if (!table?.findColumnByName('hidden_in_list')) {
      await queryRunner.query(
        `ALTER TABLE \`notification\` ADD COLUMN \`hidden_in_list\` TINYINT NOT NULL DEFAULT 0`,
      );
      await queryRunner.query(
        `UPDATE \`notification\` SET \`hidden_in_list\` = 1 WHERE \`push_pending\` = 1`,
      );
    }

    if (!table?.findColumnByName('summary_count')) {
      await queryRunner.query(
        `ALTER TABLE \`notification\` ADD COLUMN \`summary_count\` INT NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`notification\` DROP COLUMN \`summary_count\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`notification\` DROP COLUMN \`hidden_in_list\``,
    );
  }
}
