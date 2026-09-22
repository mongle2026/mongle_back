import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

const DAY_MS = 24 * 60 * 60 * 1000;

// 알림 기능: 알림 목록, 푸시 토큰, 알림 설정 표와
// 편지 알림 처리 표시(letter), 답글 대상(feed_comment) 컬럼을 추가한다.
export class AddNotification1790200000000 implements MigrationInterface {
  name = 'AddNotification1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    if (!(await queryRunner.hasTable('notification'))) {
      await queryRunner.query(
        `CREATE TABLE \`notification\` (
          \`id\` BIGINT NOT NULL AUTO_INCREMENT,
          \`user_id\` BIGINT NOT NULL,
          \`type\` VARCHAR(20) NOT NULL,
          \`status\` VARCHAR(20) NOT NULL,
          \`actor_id\` BIGINT NULL,
          \`letter_id\` BIGINT NULL,
          \`feed_id\` BIGINT NULL,
          \`comment_id\` BIGINT NULL,
          \`content\` VARCHAR(500) NULL,
          \`event_title\` VARCHAR(100) NULL,
          \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_notification_user_id\` (\`user_id\`, \`id\`),
          INDEX \`idx_notification_user_type_id\` (\`user_id\`, \`type\`, \`id\`),
          INDEX \`idx_notification_created_at\` (\`created_at\`)
        ) ENGINE=InnoDB`,
      );
    }

    if (!(await queryRunner.hasTable('push_token'))) {
      await queryRunner.query(
        `CREATE TABLE \`push_token\` (
          \`id\` BIGINT NOT NULL AUTO_INCREMENT,
          \`user_id\` BIGINT NOT NULL,
          \`token\` VARCHAR(255) NOT NULL,
          \`platform\` VARCHAR(10) NOT NULL,
          \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`uq_push_token_token\` (\`token\`),
          INDEX \`idx_push_token_user_id\` (\`user_id\`)
        ) ENGINE=InnoDB`,
      );
    }

    if (!(await queryRunner.hasTable('notification_setting'))) {
      await queryRunner.query(
        `CREATE TABLE \`notification_setting\` (
          \`id\` BIGINT NOT NULL AUTO_INCREMENT,
          \`user_id\` BIGINT NOT NULL,
          \`setting_key\` VARCHAR(30) NOT NULL,
          \`enabled\` TINYINT NOT NULL,
          \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`uq_notification_setting_user_key\` (\`user_id\`, \`setting_key\`)
        ) ENGINE=InnoDB`,
      );
    }

    await this.addColumnIfMissing(
      queryRunner,
      'letter',
      new TableColumn({
        name: 'received_notified_at',
        type: 'datetime',
        isNullable: true,
      }),
    );
    await this.addColumnIfMissing(
      queryRunner,
      'letter',
      new TableColumn({
        name: 'arriving_soon_notified_at',
        type: 'datetime',
        isNullable: true,
      }),
    );
    await this.addIndexIfMissing(
      queryRunner,
      'letter',
      new TableIndex({
        name: 'idx_letter_received_notified',
        columnNames: ['received_notified_at', 'delivery_at'],
      }),
    );
    await this.addIndexIfMissing(
      queryRunner,
      'letter',
      new TableIndex({
        name: 'idx_letter_arriving_soon_notified',
        columnNames: ['arriving_soon_notified_at', 'delivery_at'],
      }),
    );

    // 이미 도착했거나 곧 도착하는 편지에 배포 직후 알림이 한꺼번에 나가지 않도록
    // 알림 크론이 볼 필요 없는 편지는 처리 표시를 채워둔다.
    // 시각은 앱과 같은 방식(Node Date 파라미터)으로 넘겨 DB 서버 시간대와 섞이지 않게 한다.
    const now = new Date();
    const arrivingSoonThreshold = new Date(now.getTime() + DAY_MS);

    await queryRunner.query(
      `UPDATE \`letter\`
          SET \`received_notified_at\` = ?
        WHERE \`received_notified_at\` IS NULL
          AND (\`delivery_at\` IS NULL OR \`delivery_at\` <= ?)`,
      [now, now],
    );
    await queryRunner.query(
      `UPDATE \`letter\`
          SET \`arriving_soon_notified_at\` = ?
        WHERE \`arriving_soon_notified_at\` IS NULL
          AND (\`delivery_at\` IS NULL
            OR \`delivery_at\` <= ?
            OR \`sender_id\` = \`receiver_id\`)`,
      [now, arrivingSoonThreshold],
    );

    await this.addColumnIfMissing(
      queryRunner,
      'feed_comment',
      new TableColumn({
        name: 'reply_to_user_id',
        type: 'bigint',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('feed_comment', 'reply_to_user_id');
    await queryRunner.dropIndex('letter', 'idx_letter_arriving_soon_notified');
    await queryRunner.dropIndex('letter', 'idx_letter_received_notified');
    await queryRunner.dropColumn('letter', 'arriving_soon_notified_at');
    await queryRunner.dropColumn('letter', 'received_notified_at');
    await queryRunner.query(`DROP TABLE \`notification_setting\``);
    await queryRunner.query(`DROP TABLE \`push_token\``);
    await queryRunner.query(`DROP TABLE \`notification\``);
  }

  private async addColumnIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    column: TableColumn,
  ) {
    if (await queryRunner.hasColumn(tableName, column.name)) {
      return;
    }

    await queryRunner.addColumn(tableName, column);
  }

  private async addIndexIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    index: TableIndex,
  ) {
    const table = await queryRunner.getTable(tableName);

    if (table?.indices.some((existing) => existing.name === index.name)) {
      return;
    }

    await queryRunner.createIndex(tableName, index);
  }
}
