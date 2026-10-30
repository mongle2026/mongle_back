import { MigrationInterface, QueryRunner } from 'typeorm';

// 로그인하지 않은 기기도 공지 푸시를 받을 수 있게 계정 없이 토큰을 남긴다 (user_id = null)
export class MakePushTokenUserIdNullable1791300000000 implements MigrationInterface {
  name = 'MakePushTokenUserIdNullable1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 먼저 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('push_token');

    if (!table?.findColumnByName('user_id')?.isNullable) {
      await queryRunner.query(
        `ALTER TABLE \`push_token\` MODIFY \`user_id\` BIGINT NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 계정 없는 토큰은 NOT NULL 로 되돌릴 수 없어서 지운다
    await queryRunner.query(
      `DELETE FROM \`push_token\` WHERE \`user_id\` IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`push_token\` MODIFY \`user_id\` BIGINT NOT NULL`,
    );
  }
}
