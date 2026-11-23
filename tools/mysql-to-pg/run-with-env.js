/**
 * 앱용 env 파일(DB_*)을 읽어 migrate.js 의 대상 PG 설정(PG_*)으로 넘겨 실행한다.
 * 원본 MySQL 은 로컬에 복원한 백업(mongle-mysql 컨테이너)을 쓴다.
 *
 *   node run-with-env.js ../../.env.aivenpg            ← 실제 이관
 *   DRY_RUN=true node run-with-env.js ../../.env.aivenpg ← 확인만
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const envFile = process.argv[2];
if (!envFile) {
  console.error('env 파일 경로를 넘겨야 합니다. 예) node run-with-env.js ../../.env.aivenpg');
  process.exit(1);
}

const env = dotenv.parse(fs.readFileSync(path.resolve(envFile)));

const result = spawnSync(process.execPath, [path.join(__dirname, 'migrate.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    MYSQL_HOST: process.env.MYSQL_HOST ?? 'localhost',
    MYSQL_PORT: process.env.MYSQL_PORT ?? '13306',
    MYSQL_USER: process.env.MYSQL_USER ?? 'root',
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ?? 'mysql',
    MYSQL_DATABASE: process.env.MYSQL_DATABASE ?? 'defaultdb',
    PG_HOST: env.DB_HOST,
    PG_PORT: env.DB_PORT,
    PG_USER: env.DB_USERNAME,
    PG_PASSWORD: env.DB_PASSWORD,
    PG_DATABASE: env.DB_DATABASE,
    PG_SSL_CA: env.DB_SSL_CA ?? '',
    PG_SSL: env.DB_SSL ?? '',
  },
});

process.exit(result.status ?? 1);
