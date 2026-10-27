import { MigrationInterface, QueryRunner } from 'typeorm';

// 애플 가입 때 identity token 의 이메일을 저장한다. 이전 가입자와 카카오 가입자는 null
export class AddUserEmail1791100000000 implements MigrationInterface {
  name = 'AddUserEmail1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('user');

    if (!table?.findColumnByName('email')) {
      await queryRunner.query(
        `ALTER TABLE \`user\` ADD COLUMN \`email\` VARCHAR(255) NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`user\` DROP COLUMN \`email\``);
  }
}
