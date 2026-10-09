import { MigrationInterface, QueryRunner } from 'typeorm';

// 애플 로그인을 추가할 수 있도록 kakaoId 를 provider + provider_user_id 로 바꾼다.
// 애플 식별값(sub)은 문자열이라 provider_user_id 는 문자열로 둔다.
export class ReplaceUserKakaoIdWithProvider1790400000000 implements MigrationInterface {
  name = 'ReplaceUserKakaoIdWithProvider1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('user');

    if (table?.findColumnByName('provider_user_id')) {
      return;
    }

    // 기존 회원은 모두 카카오 가입자
    await queryRunner.query(
      `ALTER TABLE \`user\`
        ADD COLUMN \`provider\` VARCHAR(10) NOT NULL DEFAULT 'KAKAO',
        ADD COLUMN \`provider_user_id\` VARCHAR(100) NULL`,
    );
    await queryRunner.query(
      `UPDATE \`user\` SET \`provider_user_id\` = CAST(\`kakaoId\` AS CHAR)`,
    );
    // 기본값은 옮길 때만 쓰고 없앤다
    await queryRunner.query(
      `ALTER TABLE \`user\`
        MODIFY \`provider\` VARCHAR(10) NOT NULL,
        MODIFY \`provider_user_id\` VARCHAR(100) NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX \`UQ_user_provider_user_id\` ON \`user\` (\`provider\`, \`provider_user_id\`)`,
    );
    // kakaoId 의 unique 인덱스도 함께 지워진다
    await queryRunner.query(`ALTER TABLE \`user\` DROP COLUMN \`kakaoId\``);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 카카오가 아닌 회원이 있으면 kakaoId 를 채울 수 없어 NOT NULL 단계에서 실패한다
    await queryRunner.query(
      `ALTER TABLE \`user\` ADD COLUMN \`kakaoId\` BIGINT NULL`,
    );
    await queryRunner.query(
      `UPDATE \`user\` SET \`kakaoId\` = CAST(\`provider_user_id\` AS UNSIGNED) WHERE \`provider\` = 'KAKAO'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`user\` MODIFY \`kakaoId\` BIGINT NOT NULL, ADD UNIQUE INDEX \`IDX_c38c5232df7705ce60e9cefcab\` (\`kakaoId\`)`,
    );
    await queryRunner.query(
      `DROP INDEX \`UQ_user_provider_user_id\` ON \`user\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`user\` DROP COLUMN \`provider_user_id\`, DROP COLUMN \`provider\``,
    );
  }
}
