import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLetterSenderIdAndMusicUpdatedAt1789025865218
  implements MigrationInterface {
  name = 'AddLetterSenderIdAndMusicUpdatedAt1789025865218';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`letter\` ADD COLUMN \`sender_id\` BIGINT NULL`,
    );

    await queryRunner.query(`
      UPDATE \`letter\` l
      INNER JOIN \`record\` r ON r.id = l.record_id
      SET l.sender_id = r.user_id
    `);

    await queryRunner.query(
      `ALTER TABLE \`letter\` MODIFY \`sender_id\` BIGINT NOT NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX \`idx_letter_receiver_read_id\` ON \`letter\` (\`receiver_id\`, \`is_read\`, \`id\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`idx_letter_receiver_id\` ON \`letter\` (\`receiver_id\`, \`id\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`idx_letter_sender_id\` ON \`letter\` (\`sender_id\`, \`id\`)`,
    );

    await queryRunner.query(
      `ALTER TABLE \`music\` ADD COLUMN \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`music\` DROP COLUMN \`updated_at\``);

    await queryRunner.query(
      `DROP INDEX \`idx_letter_sender_id\` ON \`letter\``,
    );
    await queryRunner.query(
      `DROP INDEX \`idx_letter_receiver_id\` ON \`letter\``,
    );
    await queryRunner.query(
      `DROP INDEX \`idx_letter_receiver_read_id\` ON \`letter\``,
    );

    await queryRunner.query(`ALTER TABLE \`letter\` DROP COLUMN \`sender_id\``);
  }
}
