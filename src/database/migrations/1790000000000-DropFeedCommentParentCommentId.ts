import { MigrationInterface, QueryRunner } from 'typeorm';

// 답글은 1단계뿐이라 "어떤 답글에 답글을 달았는지"는 더 이상 쓰지 않는다.
// 묶음 기준인 root_comment_id 만 남기고 parent_comment_id 를 걷어낸다.
export class DropFeedCommentParentCommentId1790000000000
  implements MigrationInterface
{
  name = 'DropFeedCommentParentCommentId1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('feed_comment');

    if (!table?.findColumnByName('parent_comment_id')) {
      return;
    }

    // root_comment_id 가 생기기 전에 저장된 답글은 부모만 들고 있다.
    // 컬럼을 지우기 전에 묶음 정보를 root_comment_id 로 옮겨둔다.
    // (부모가 또 답글인 경우가 있어서 두 번 돌린다)
    for (let i = 0; i < 2; i += 1) {
      await queryRunner.query(
        `UPDATE \`feed_comment\` AS c
           JOIN \`feed_comment\` AS p ON p.\`id\` = c.\`parent_comment_id\`
            SET c.\`root_comment_id\` = COALESCE(p.\`root_comment_id\`, p.\`id\`)
          WHERE c.\`root_comment_id\` IS NULL
            AND c.\`parent_comment_id\` IS NOT NULL`,
      );
    }

    // synchronize 로 만들어진 외래키는 이름이 무작위라 조회해서 지운다
    const foreignKeys = table.foreignKeys.filter((foreignKey) =>
      foreignKey.columnNames.includes('parent_comment_id'),
    );

    for (const foreignKey of foreignKeys) {
      await queryRunner.dropForeignKey('feed_comment', foreignKey);
    }

    await queryRunner.query(
      `ALTER TABLE \`feed_comment\` DROP COLUMN \`parent_comment_id\``,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('feed_comment');

    if (table?.findColumnByName('parent_comment_id')) {
      return;
    }

    await queryRunner.query(
      `ALTER TABLE \`feed_comment\` ADD COLUMN \`parent_comment_id\` BIGINT NULL`,
    );

    // 원래 부모가 무엇이었는지는 복구할 수 없다.
    // 답글은 모두 원댓글 바로 아래에 달린 것으로 되돌린다.
    await queryRunner.query(
      `UPDATE \`feed_comment\`
          SET \`parent_comment_id\` = \`root_comment_id\`
        WHERE \`root_comment_id\` IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE \`feed_comment\`
         ADD CONSTRAINT \`FK_feed_comment_parent_comment_id\`
         FOREIGN KEY (\`parent_comment_id\`)
         REFERENCES \`feed_comment\`(\`id\`)
         ON DELETE SET NULL`,
    );
  }
}
