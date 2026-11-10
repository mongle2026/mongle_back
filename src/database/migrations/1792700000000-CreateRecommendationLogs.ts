import { MigrationInterface, QueryRunner } from 'typeorm';

// 추천 피드용 기록 두 가지.
// - music_play: 회원이 미리듣기를 재생해 본 음악 (회원 · 음악마다 한 줄). 취향 신호 "재생해 본 음악"
// - feed_impression: 추천 피드가 회원에게 내려준 글 (회원 · 글마다 한 줄). "이미 노출된 게시물" 규칙
// 회원 · 글 · 음악이 지워지면 기록도 함께 지운다.
export class CreateRecommendationLogs1792700000000 implements MigrationInterface {
  name = 'CreateRecommendationLogs1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    if (!(await queryRunner.hasTable('music_play'))) {
      await queryRunner.query(
        `CREATE TABLE \`music_play\` (
          \`id\` BIGINT NOT NULL AUTO_INCREMENT,
          \`user_id\` BIGINT NOT NULL,
          \`music_id\` BIGINT NOT NULL,
          \`play_count\` INT UNSIGNED NOT NULL DEFAULT 1,
          \`last_played_at\` DATETIME NOT NULL,
          \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`UQ_music_play_user_music\` (\`user_id\`, \`music_id\`),
          INDEX \`IDX_music_play_user_last_played\` (\`user_id\`, \`last_played_at\`),
          CONSTRAINT \`FK_music_play_user_id\` FOREIGN KEY (\`user_id\`)
            REFERENCES \`user\` (\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`FK_music_play_music_id\` FOREIGN KEY (\`music_id\`)
            REFERENCES \`music\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB`,
      );
    }

    if (!(await queryRunner.hasTable('feed_impression'))) {
      await queryRunner.query(
        `CREATE TABLE \`feed_impression\` (
          \`id\` BIGINT NOT NULL AUTO_INCREMENT,
          \`user_id\` BIGINT NOT NULL,
          \`feed_id\` BIGINT NOT NULL,
          \`served_at\` DATETIME NOT NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`UQ_feed_impression_user_feed\` (\`user_id\`, \`feed_id\`),
          INDEX \`IDX_feed_impression_user_served\` (\`user_id\`, \`served_at\`),
          INDEX \`IDX_feed_impression_served_at\` (\`served_at\`),
          CONSTRAINT \`FK_feed_impression_user_id\` FOREIGN KEY (\`user_id\`)
            REFERENCES \`user\` (\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`FK_feed_impression_feed_id\` FOREIGN KEY (\`feed_id\`)
            REFERENCES \`feed\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `feed_impression`');
    await queryRunner.query('DROP TABLE IF EXISTS `music_play`');
  }
}
