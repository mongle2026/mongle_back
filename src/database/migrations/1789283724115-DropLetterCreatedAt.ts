import { MigrationInterface, QueryRunner } from 'typeorm';

// letter.created_at은 같은 트랜잭션에서 생성되는 record.created_at과 값이 같아 중복이었음.
// 보낸 시각은 record.created_at, 정렬은 letter.id(auto increment = 생성 순서)로 대체한다.
// (receiver_id, stamp) 인덱스는 InnoDB가 PK(id)를 뒤에 붙이므로 사실상 (receiver_id, stamp, id).
export class DropLetterCreatedAt1789283724115 implements MigrationInterface {
  name = 'DropLetterCreatedAt1789283724115';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('letter');

    if (
      table?.indices.some(
        (index) => index.name === 'idx_letter_receiver_stamp_created',
      )
    ) {
      await queryRunner.query(
        `DROP INDEX \`idx_letter_receiver_stamp_created\` ON \`letter\``,
      );
    }

    if (table?.findColumnByName('created_at')) {
      await queryRunner.query(
        `ALTER TABLE \`letter\` DROP COLUMN \`created_at\``,
      );
    }

    if (
      !table?.indices.some(
        (index) => index.name === 'idx_letter_receiver_stamp',
      )
    ) {
      await queryRunner.query(
        `CREATE INDEX \`idx_letter_receiver_stamp\` ON \`letter\` (\`receiver_id\`, \`stamp\`)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`idx_letter_receiver_stamp\` ON \`letter\``,
    );

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
  }
}
