import { MigrationInterface, QueryRunner } from 'typeorm';

// 편지 삭제는 삭제한 사람의 편지함에서만 숨긴다 (상대방 편지함에는 그대로 남음).
// 보낸 사람 / 받는 사람 각각의 삭제 시각을 따로 둔다.
export class AddLetterDeletedAt1789460000000 implements MigrationInterface {
  name = 'AddLetterDeletedAt1789460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('letter');

    if (!table?.findColumnByName('sender_deleted_at')) {
      await queryRunner.query(
        `ALTER TABLE \`letter\` ADD COLUMN \`sender_deleted_at\` DATETIME NULL`,
      );
    }

    if (!table?.findColumnByName('receiver_deleted_at')) {
      await queryRunner.query(
        `ALTER TABLE \`letter\` ADD COLUMN \`receiver_deleted_at\` DATETIME NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`letter\` DROP COLUMN \`receiver_deleted_at\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`letter\` DROP COLUMN \`sender_deleted_at\``,
    );
  }
}
