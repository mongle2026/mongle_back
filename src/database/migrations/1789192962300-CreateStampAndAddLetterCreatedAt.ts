import { MigrationInterface, QueryRunner } from 'typeorm';

// 프론트 envelopeData.js STAMPS 배열(s1~s26)과 동일한 코드로 초기 시드
const STAMP_CODES = Array.from({ length: 26 }, (_, i) => `s${i + 1}`);

export class CreateStampAndAddLetterCreatedAt1789192962300
  implements MigrationInterface
{
  name = 'CreateStampAndAddLetterCreatedAt1789192962300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`stamp\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT,
        \`code\` VARCHAR(255) NOT NULL,
        \`sort_order\` INT NOT NULL,
        \`is_active\` TINYINT NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`IDX_stamp_code\` (\`code\`)
      ) ENGINE=InnoDB
    `);

    const values = STAMP_CODES.map(
      (code, index) => `('${code}', ${index + 1}, 1)`,
    ).join(', ');
    await queryRunner.query(
      `INSERT INTO \`stamp\` (\`code\`, \`sort_order\`, \`is_active\`) VALUES ${values}`,
    );

    // letter는 지금까지 자체 생성 시각이 없었음 (record.created_at으로만 추정 가능했음).
    // nullable로 추가 -> record.created_at으로 backfill -> NOT NULL 전환.
    await queryRunner.query(
      `ALTER TABLE \`letter\` ADD COLUMN \`created_at\` DATETIME NULL`,
    );
    await queryRunner.query(`
      UPDATE \`letter\` l
      INNER JOIN \`record\` r ON r.id = l.record_id
      SET l.created_at = r.created_at
    `);
    await queryRunner.query(
      `ALTER TABLE \`letter\` MODIFY \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    );

    await queryRunner.query(
      `CREATE INDEX \`idx_letter_receiver_stamp_created\` ON \`letter\` (\`receiver_id\`, \`stamp\`, \`created_at\`)`,
    );

    // letter.stamp 값이 stamp.code 시드와 정확히 일치해야 FK 생성이 성공함.
    // (기존 데이터에 s1~s26 범위 밖 값이 있으면 이 ALTER가 실패하므로 배포 전 확인 필요)
    await queryRunner.query(`
      ALTER TABLE \`letter\`
      ADD CONSTRAINT \`fk_letter_stamp\` FOREIGN KEY (\`stamp\`) REFERENCES \`stamp\` (\`code\`)
      ON UPDATE CASCADE ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`letter\` DROP FOREIGN KEY \`fk_letter_stamp\``,
    );
    await queryRunner.query(
      `DROP INDEX \`idx_letter_receiver_stamp_created\` ON \`letter\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`letter\` DROP COLUMN \`created_at\``,
    );
    await queryRunner.query(`DROP TABLE \`stamp\``);
  }
}
