import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

// 처리(가림 · 경고 · 영구 정지 · 기각)가 끝난 신고는 같은 사람이 같은 대상을 다시 신고할 수 있게 한다.
// - report.pending_key: 처리 전이면 1, 처리했으면 null (status 로 계산하는 생성 컬럼)
// - UQ_report_reporter_target(reporter_id, target_type, target_id) 대신
//   UQ_report_pending_reporter_target(reporter_id, target_type, target_id, pending_key).
//   MySQL 유니크 인덱스는 null 끼리 겹쳐도 되므로 처리 전 신고만 중복을 막는다
// - typeorm_metadata: TypeORM 이 생성 컬럼의 식을 기억하는 테이블. synchronize 가 컬럼을 다시 만들지 않게 같이 남긴다
//
// 새 유니크 인덱스를 먼저 만들고 예전 인덱스를 지운다. FK_report_reporter_id 가 reporter_id 로 시작하는 인덱스를 써야 해서다.
// (synchronize 는 예전 인덱스를 먼저 지우려다 실패하므로, 개발 서버를 새 코드로 켜기 전에 이 마이그레이션을 먼저 돌린다)
const PENDING_KEY_EXPRESSION = "IF(`status` = 'PENDING', 1, NULL)";
const NEW_UNIQUE = 'UQ_report_pending_reporter_target';
const OLD_UNIQUE = 'UQ_report_reporter_target';

export class AllowReportAgainAfterHandled1792600000000 implements MigrationInterface {
  name = 'AllowReportAgainAfterHandled1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`typeorm_metadata\` (
        \`type\` VARCHAR(255) NOT NULL,
        \`database\` VARCHAR(255) NULL,
        \`schema\` VARCHAR(255) NULL,
        \`table\` VARCHAR(255) NULL,
        \`name\` VARCHAR(255) NULL,
        \`value\` TEXT NULL
      ) ENGINE=InnoDB`,
    );

    // 개발 DB는 synchronize로 먼저 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const report = await queryRunner.getTable('report');

    if (!report?.findColumnByName('pending_key')) {
      // addColumn 이 typeorm_metadata 에 식도 함께 남긴다
      await queryRunner.addColumn(
        'report',
        new TableColumn({
          name: 'pending_key',
          type: 'tinyint',
          isNullable: true,
          generatedType: 'STORED',
          asExpression: PENDING_KEY_EXPRESSION,
        }),
      );
    }

    if (!(await this.hasIndex(queryRunner, NEW_UNIQUE))) {
      await queryRunner.query(
        `CREATE UNIQUE INDEX \`${NEW_UNIQUE}\` ON \`report\` (\`reporter_id\`, \`target_type\`, \`target_id\`, \`pending_key\`)`,
      );
    }

    if (await this.hasIndex(queryRunner, OLD_UNIQUE)) {
      await queryRunner.query(`DROP INDEX \`${OLD_UNIQUE}\` ON \`report\``);
    }
  }

  // 되돌릴 때 같은 사람이 같은 대상을 다시 신고한 행이 있으면 예전 유니크 인덱스를 만들 수 없다. 그런 행을 먼저 정리해야 한다
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX \`${OLD_UNIQUE}\` ON \`report\` (\`reporter_id\`, \`target_type\`, \`target_id\`)`,
    );
    await queryRunner.query(`DROP INDEX \`${NEW_UNIQUE}\` ON \`report\``);

    const report = await queryRunner.getTable('report');
    const pendingKey = report?.findColumnByName('pending_key');

    if (report && pendingKey) {
      // dropColumn 이 typeorm_metadata 의 식도 함께 지운다
      await queryRunner.dropColumn(report, pendingKey);
    }
  }

  private async hasIndex(queryRunner: QueryRunner, indexName: string) {
    const rows = (await queryRunner.query(
      `SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'report' AND index_name = ?
        LIMIT 1`,
      [indexName],
    )) as unknown[];

    return rows.length > 0;
  }
}
