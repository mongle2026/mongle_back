import { MigrationInterface, QueryRunner } from 'typeorm';

// 삭제 보관 기간이 지난 피드·댓글·편지를 찾는 정리 크론이 테이블 전체를 훑지 않도록 인덱스를 건다.
const INDEXES = [
  { table: 'feed', name: 'idx_feed_deleted_at', columns: '`deleted_at`' },
  {
    table: 'feed_comment',
    name: 'idx_feed_comment_deleted_at',
    columns: '`deleted_at`',
  },
  {
    table: 'letter',
    name: 'idx_letter_deleted_at',
    columns: '`sender_deleted_at`, `receiver_deleted_at`',
  },
];

export class AddDeletedAtIndexes1790900000000 implements MigrationInterface {
  name = 'AddDeletedAtIndexes1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const index of INDEXES) {
      // 개발 DB는 synchronize로 먼저 반영됐을 수 있어서 존재 여부를 확인하고 진행
      const table = await queryRunner.getTable(index.table);

      if (!table?.indices.some((existing) => existing.name === index.name)) {
        await queryRunner.query(
          `CREATE INDEX \`${index.name}\` ON \`${index.table}\` (${index.columns})`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const index of [...INDEXES].reverse()) {
      await queryRunner.query(
        `DROP INDEX \`${index.name}\` ON \`${index.table}\``,
      );
    }
  }
}
