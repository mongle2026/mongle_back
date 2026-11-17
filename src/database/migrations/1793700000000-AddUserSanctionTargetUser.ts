import { MigrationInterface, QueryRunner } from 'typeorm';

// user_sanction.target_user_id: 운영정책 안내 화면의 대상 카드에 아이디를 보여줄 상대 회원.
// 댓글은 댓글을 단 피드의 작성자, 편지는 받은 사람. 피드 · 회원 신고는 null.
// 상대가 탈퇴해 지워져도 제재 기록은 남아야 해서 FK 는 걸지 않는다.
// 이미 남긴 댓글 · 편지 제재는 대상이 아직 남아 있으면 채운다
export class AddUserSanctionTargetUser1793700000000 implements MigrationInterface {
  name = 'AddUserSanctionTargetUser1793700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('user_sanction');

    // 개발 DB는 synchronize로 이미 반영됐을 수 있다
    if (!table?.findColumnByName('target_user_id')) {
      await queryRunner.query(
        'ALTER TABLE `user_sanction` ADD `target_user_id` BIGINT NULL AFTER `content_preview`',
      );
    }

    await queryRunner.query(
      `UPDATE \`user_sanction\` us
        JOIN \`letter\` l ON l.\`id\` = us.\`target_id\`
        SET us.\`target_user_id\` = l.\`receiver_id\`
        WHERE us.\`target_type\` = 'LETTER' AND us.\`target_user_id\` IS NULL`,
    );

    await queryRunner.query(
      `UPDATE \`user_sanction\` us
        JOIN \`feed_comment\` c ON c.\`id\` = us.\`target_id\`
        JOIN \`feed\` f ON f.\`id\` = c.\`feed_id\`
        JOIN \`record\` r ON r.\`id\` = f.\`record_id\`
        SET us.\`target_user_id\` = r.\`user_id\`
        WHERE us.\`target_type\` = 'COMMENT' AND us.\`target_user_id\` IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `user_sanction` DROP COLUMN `target_user_id`',
    );
  }
}
