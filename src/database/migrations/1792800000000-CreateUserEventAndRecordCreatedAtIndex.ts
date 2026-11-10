import { MigrationInterface, QueryRunner } from 'typeorm';

// - user_event: 사용자 행동 기록 (피드 상세 체류 · 음악 들은 시간 · 좋아요/북마크와 취소). 회원이 지워지면 함께 지운다.
//   feed_id · music_id 는 글이 지워져도 기록을 남기려고 FK 를 걸지 않는다
// - record.created_at 인덱스: 추천 피드 후보를 최근 N일 글로 거를 때 쓴다
export class CreateUserEventAndRecordCreatedAtIndex1792800000000 implements MigrationInterface {
  name = 'CreateUserEventAndRecordCreatedAtIndex1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    if (!(await queryRunner.hasTable('user_event'))) {
      await queryRunner.query(
        `CREATE TABLE \`user_event\` (
          \`id\` BIGINT NOT NULL AUTO_INCREMENT,
          \`user_id\` BIGINT NOT NULL,
          \`event_type\` VARCHAR(30) NOT NULL,
          \`feed_id\` BIGINT NULL,
          \`music_id\` BIGINT NULL,
          \`duration_ms\` INT UNSIGNED NULL,
          \`position_ms\` INT UNSIGNED NULL,
          \`detail\` VARCHAR(20) NULL,
          \`occurred_at\` DATETIME NOT NULL,
          \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`IDX_user_event_user_occurred\` (\`user_id\`, \`occurred_at\`),
          INDEX \`IDX_user_event_feed_type\` (\`feed_id\`, \`event_type\`),
          INDEX \`IDX_user_event_occurred_at\` (\`occurred_at\`),
          CONSTRAINT \`FK_user_event_user_id\` FOREIGN KEY (\`user_id\`)
            REFERENCES \`user\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB`,
      );
    }

    if (!(await this.hasIndex(queryRunner, 'record', 'IDX_record_created_at'))) {
      await queryRunner.query(
        'CREATE INDEX `IDX_record_created_at` ON `record` (`created_at`)',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `IDX_record_created_at` ON `record`');
    await queryRunner.query('DROP TABLE IF EXISTS `user_event`');
  }

  private async hasIndex(queryRunner: QueryRunner, table: string, indexName: string) {
    const rows = (await queryRunner.query(
      `SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
        LIMIT 1`,
      [table, indexName],
    )) as unknown[];

    return rows.length > 0;
  }
}
