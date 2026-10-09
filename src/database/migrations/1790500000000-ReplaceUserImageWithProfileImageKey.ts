import { MigrationInterface, QueryRunner } from 'typeorm';

// 프로필 사진을 가입 전에 미리 올릴 수 있도록, 경로를 userId 로 정하지 않고 키를 저장한다.
// image_mime_type / image_updated_at 대신 profile_image_key 하나로 사진 유무와 주소를 나타낸다.
// 붙지 않은 사진을 정리하기 위한 profile_image_pending 도 만든다.
export class ReplaceUserImageWithProfileImageKey1790500000000 implements MigrationInterface {
  name = 'ReplaceUserImageWithProfileImageKey1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 개발 DB는 synchronize로 이미 반영됐을 수 있어서 존재 여부를 확인하고 진행
    const table = await queryRunner.getTable('user');

    if (!table?.findColumnByName('profile_image_key')) {
      await queryRunner.query(
        `ALTER TABLE \`user\` ADD COLUMN \`profile_image_key\` VARCHAR(100) NULL`,
      );
    }

    if (table?.findColumnByName('image_mime_type')) {
      // 기존 사진은 profile/{id}.jpg 에 올라가 있다
      await queryRunner.query(
        `UPDATE \`user\` SET \`profile_image_key\` = CONCAT('profile/', \`id\`, '.jpg')
          WHERE \`image_mime_type\` IS NOT NULL AND \`profile_image_key\` IS NULL`,
      );
      await queryRunner.query(
        `ALTER TABLE \`user\` DROP COLUMN \`image_mime_type\`, DROP COLUMN \`image_updated_at\``,
      );
    }

    if (!(await queryRunner.hasTable('profile_image_pending'))) {
      await queryRunner.query(
        `CREATE TABLE \`profile_image_pending\` (
          \`id\` BIGINT NOT NULL AUTO_INCREMENT,
          \`file_key\` VARCHAR(100) NOT NULL,
          \`purge_after\` DATETIME NOT NULL,
          \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          UNIQUE INDEX \`UQ_profile_image_pending_file_key\` (\`file_key\`),
          INDEX \`IDX_profile_image_pending_purge_after\` (\`purge_after\`),
          PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`profile_image_pending\``);

    await queryRunner.query(
      `ALTER TABLE \`user\`
        ADD COLUMN \`image_mime_type\` VARCHAR(50) NULL,
        ADD COLUMN \`image_updated_at\` DATETIME NULL`,
    );
    // 예전 방식 경로(profile/{id}.jpg)인 사진만 되돌릴 수 있다. uuid 키로 올린 사진은 사진 없음이 된다
    await queryRunner.query(
      `UPDATE \`user\` SET \`image_mime_type\` = 'image/jpeg', \`image_updated_at\` = \`updated_at\`
        WHERE \`profile_image_key\` = CONCAT('profile/', \`id\`, '.jpg')`,
    );
    await queryRunner.query(
      `ALTER TABLE \`user\` DROP COLUMN \`profile_image_key\``,
    );
  }
}
