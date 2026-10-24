import { MigrationInterface, QueryRunner } from 'typeorm';

// 회원 탈퇴. 탈퇴한 회원은 행을 남기고 개인정보만 비운다.
// 같은 소셜 계정으로 다시 가입하고 아이디를 다른 회원이 다시 쓸 수 있도록
// provider_user_id / user_code 를 null 로 비울 수 있게 한다. (unique 인덱스는 null 을 여러 개 허용)
export class AddUserWithdrawnAt1791000000000 implements MigrationInterface {
  name = 'AddUserWithdrawnAt1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 먼저 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('user');

    if (!table?.findColumnByName('withdrawn_at')) {
      await queryRunner.query(
        `ALTER TABLE \`user\` ADD COLUMN \`withdrawn_at\` DATETIME NULL`,
      );
    }

    // 이미 NULL 허용이어도 같은 정의로 다시 바꿀 뿐이다
    await queryRunner.query(
      `ALTER TABLE \`user\`
        MODIFY \`user_code\` VARCHAR(30) NULL,
        MODIFY \`provider_user_id\` VARCHAR(100) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 탈퇴한 회원이 있으면 null 이 남아 있어 NOT NULL 단계에서 실패한다
    await queryRunner.query(
      `ALTER TABLE \`user\`
        MODIFY \`user_code\` VARCHAR(30) NOT NULL,
        MODIFY \`provider_user_id\` VARCHAR(100) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`user\` DROP COLUMN \`withdrawn_at\``,
    );
  }
}
