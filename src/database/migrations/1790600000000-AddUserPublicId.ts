import { MigrationInterface, QueryRunner } from 'typeorm';

// 앱에 user.id(자동 증가) 대신 보여줄 회원 식별값. 가입 순서나 회원 수를 짐작할 수 없고,
// 바뀔 수 있는 userCode 와 달리 한 번 정하면 바뀌지 않는다.
export class AddUserPublicId1790600000000 implements MigrationInterface {
  name = 'AddUserPublicId1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 컬럼만 먼저 생겼을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('user');

    if (!table?.findColumnByName('public_id')) {
      await queryRunner.query(
        `ALTER TABLE \`user\` ADD COLUMN \`public_id\` CHAR(36) NULL`,
      );
    }

    // 기존 회원은 한 명씩 새로 만든다 (synchronize 가 넣은 빈 문자열도 채운다)
    await queryRunner.query(
      `UPDATE \`user\` SET \`public_id\` = UUID() WHERE \`public_id\` IS NULL OR \`public_id\` = ''`,
    );
    await queryRunner.query(
      `ALTER TABLE \`user\` MODIFY \`public_id\` CHAR(36) NOT NULL`,
    );

    if (!table?.indices.some((index) => index.name === 'UQ_user_public_id')) {
      await queryRunner.query(
        `CREATE UNIQUE INDEX \`UQ_user_public_id\` ON \`user\` (\`public_id\`)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`UQ_user_public_id\` ON \`user\``);
    await queryRunner.query(`ALTER TABLE \`user\` DROP COLUMN \`public_id\``);
  }
}
