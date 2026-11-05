import { MigrationInterface, QueryRunner } from 'typeorm';

// 신고 상세 내용을 앱 입력 제한(200자)에 맞춰 500자 → 200자로 줄인다.
export class ShortenReportDetail1791900000000 implements MigrationInterface {
  name = 'ShortenReportDetail1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 먼저 반영됐을 수 있어서 길이를 확인하고 진행
    const table = await queryRunner.getTable('report');
    const column = table?.findColumnByName('detail');

    if (!column || Number(column.length) === 200) {
      return;
    }

    // 운영 전이라 200자를 넘는 신고(테스트 데이터)는 잘라서 맞춘다. 안 자르면 컬럼을 줄일 때 에러가 난다
    await queryRunner.query(
      `UPDATE \`report\` SET \`detail\` = LEFT(\`detail\`, 200) WHERE CHAR_LENGTH(\`detail\`) > 200`,
    );

    await queryRunner.query(
      `ALTER TABLE \`report\` MODIFY \`detail\` VARCHAR(200) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`report\` MODIFY \`detail\` VARCHAR(500) NULL`,
    );
  }
}
