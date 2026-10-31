import { MigrationInterface, QueryRunner } from 'typeorm';

// 탈퇴한 회원의 닉네임을 빈 문자열 대신 null 로 비운다. (다른 개인정보 컬럼과 같게)
export class MakeUserNicknameNullable1791400000000 implements MigrationInterface {
  name = 'MakeUserNicknameNullable1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 먼저 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('user');

    if (!table?.findColumnByName('nickname')?.isNullable) {
      await queryRunner.query(
        `ALTER TABLE \`user\` MODIFY \`nickname\` VARCHAR(50) NULL`,
      );
    }

    // 이미 탈퇴한 회원의 빈 문자열도 null 로 바꾼다
    await queryRunner.query(
      `UPDATE \`user\` SET \`nickname\` = NULL WHERE \`withdrawn_at\` IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE \`user\` SET \`nickname\` = '' WHERE \`nickname\` IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`user\` MODIFY \`nickname\` VARCHAR(50) NOT NULL`,
    );
  }
}
