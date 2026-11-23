/**
 * MySQL → PostgreSQL 데이터 이관 (한 번만 쓰는 도구)
 *
 * 전제
 * - 원본: mysql-final 태그 시점 스키마의 MySQL (백업을 복원한 로컬 MySQL 을 쓴다. 운영 DB 에 직접 붙이지 않는다)
 * - 대상: InitPostgres 마이그레이션만 적용된 빈 PostgreSQL
 *
 * 하는 일
 * 1. 대상 PG 의 테이블 · 컬럼 타입을 읽는다 (migrations 테이블은 뺀다)
 * 2. 원본과 대상의 컬럼이 같은지 확인한다. 다르면 아무것도 쓰지 않고 멈춘다
 * 3. 대상 테이블이 모두 비어 있는지 확인한다. 하나라도 행이 있으면 멈춘다
 * 4. 외래키 순서대로 테이블을 id 순으로 옮긴다. PG 컬럼 타입에 맞춰 값을 바꾼다
 *    - boolean     ← MySQL tinyint(1) 0/1
 *    - timestamptz ← MySQL datetime. 앱이 UTC 로 저장해 왔으므로 '+00' 을 붙여 UTC 로 넣는다 (마이크로초 유지)
 *    - jsonb       ← MySQL json. JSON null 은 SQL NULL 로 넣는다
 * 5. 시퀀스(id 자동 증가)를 각 테이블 최대 id 로 맞춘다
 * 6. 테이블마다 행 수를 다시 세어 원본과 비교한다
 * 1~6 은 PG 트랜잭션 하나로 묶여서, 중간에 실패하면 대상에는 아무것도 남지 않는다.
 *
 * 실행 (접속 정보는 환경변수로)
 *   MYSQL_HOST=localhost MYSQL_PORT=13306 MYSQL_USER=root MYSQL_PASSWORD=... MYSQL_DATABASE=...
 *   PG_HOST=localhost PG_PORT=15432 PG_USER=postgres PG_PASSWORD=... PG_DATABASE=... [PG_SSL=true]
 *   [DRY_RUN=true]  ← 확인(2, 3)과 행 수 세기만 하고 쓰지 않는다
 *   node migrate.js
 */
const mysql = require('mysql2/promise');
const { Client } = require('pg');

const BATCH_SIZE = 500;
const SKIP_TABLES = new Set(['migrations', 'typeorm_metadata']);
const DRY_RUN = process.env.DRY_RUN === 'true';

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined) throw new Error(`환경변수 ${name} 이(가) 없습니다.`);
  return value;
}

// PG 컬럼 타입에 맞춰 MySQL 값을 바꾼다
function convertValue(value, pgType) {
  if (value === null || value === undefined) return null;

  switch (pgType) {
    case 'boolean':
      return Number(value) !== 0;
    case 'timestamp with time zone':
      // dateStrings 로 받은 'YYYY-MM-DD HH:MM:SS[.ffffff]' 는 UTC 값이다
      return `${value}+00`;
    case 'jsonb':
    case 'json': {
      // mysql2 는 JSON 컬럼을 파싱해서 준다. 문자열로 오면 그대로 파싱해 본다
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return parsed === null ? null : JSON.stringify(parsed);
    }
    default:
      return value;
  }
}

// 외래키를 따라 부모 테이블이 먼저 오도록 줄 세운다 (자기 자신을 가리키는 외래키는 id 순 삽입으로 해결)
function sortByForeignKeys(tables, edges) {
  const sorted = [];
  const visiting = new Set();
  const done = new Set();

  const visit = (table) => {
    if (done.has(table)) return;
    if (visiting.has(table)) throw new Error(`외래키가 순환합니다: ${table}`);
    visiting.add(table);
    for (const parent of edges.get(table) ?? []) {
      if (parent !== table && tables.includes(parent)) visit(parent);
    }
    visiting.delete(table);
    done.add(table);
    sorted.push(table);
  };

  tables.forEach(visit);
  return sorted;
}

async function main() {
  const my = await mysql.createConnection({
    host: requireEnv('MYSQL_HOST'),
    port: Number(requireEnv('MYSQL_PORT')),
    user: requireEnv('MYSQL_USER'),
    password: requireEnv('MYSQL_PASSWORD'),
    database: requireEnv('MYSQL_DATABASE'),
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });

  const pg = new Client({
    host: requireEnv('PG_HOST'),
    port: Number(requireEnv('PG_PORT')),
    user: requireEnv('PG_USER'),
    password: requireEnv('PG_PASSWORD'),
    database: requireEnv('PG_DATABASE'),
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    options: '-c TimeZone=UTC',
  });
  await pg.connect();

  try {
    // 1. 대상 스키마 읽기
    const { rows: columnRows } = await pg.query(`
      SELECT table_name, column_name, data_type
        FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position`);
    const pgColumns = new Map();
    for (const row of columnRows) {
      if (SKIP_TABLES.has(row.table_name)) continue;
      if (!pgColumns.has(row.table_name)) pgColumns.set(row.table_name, []);
      pgColumns.get(row.table_name).push({ name: row.column_name, type: row.data_type });
    }

    const { rows: fkRows } = await pg.query(`
      SELECT cl.relname AS child, pcl.relname AS parent
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        JOIN pg_class pcl ON pcl.oid = c.confrelid
       WHERE c.contype = 'f'`);
    const edges = new Map();
    for (const { child, parent } of fkRows) {
      if (!edges.has(child)) edges.set(child, []);
      edges.get(child).push(parent);
    }
    const tables = sortByForeignKeys([...pgColumns.keys()].sort(), edges);

    // 2. 컬럼 비교
    const problems = [];
    const sourceCounts = new Map();
    for (const table of tables) {
      const [myCols] = await my.query(
        'SELECT column_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
        [table],
      );
      if (myCols.length === 0) {
        problems.push(`${table}: MySQL 에 테이블이 없음`);
        continue;
      }
      const myNames = new Set(myCols.map((c) => c.name ?? c.NAME));
      const pgNames = new Set(pgColumns.get(table).map((c) => c.name));
      const onlyPg = [...pgNames].filter((n) => !myNames.has(n));
      const onlyMy = [...myNames].filter((n) => !pgNames.has(n));
      if (onlyPg.length) problems.push(`${table}: PG 에만 있는 컬럼 ${onlyPg.join(', ')}`);
      if (onlyMy.length) problems.push(`${table}: MySQL 에만 있는 컬럼 ${onlyMy.join(', ')}`);

      const [[{ n }]] = await my.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      sourceCounts.set(table, Number(n));
    }

    // 3. 대상이 비어 있는지
    for (const table of tables) {
      const { rows } = await pg.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
      if (rows[0].n > 0) problems.push(`${table}: 대상 PG 에 이미 ${rows[0].n}행이 있음`);
    }

    console.log('옮길 순서와 원본 행 수:');
    for (const table of tables) console.log(`  ${table}: ${sourceCounts.get(table) ?? '-'}`);

    if (problems.length > 0) {
      console.error('\n멈춥니다. 아래를 먼저 해결해야 합니다:');
      problems.forEach((p) => console.error(`  - ${p}`));
      process.exitCode = 1;
      return;
    }

    if (DRY_RUN) {
      console.log('\nDRY_RUN: 확인만 하고 쓰지 않았습니다.');
      return;
    }

    // 4. 옮기기 (트랜잭션 하나)
    await pg.query('BEGIN');
    for (const table of tables) {
      const cols = pgColumns.get(table);
      const colList = cols.map((c) => `"${c.name}"`).join(', ');
      const hasId = cols.some((c) => c.name === 'id');
      let lastId = null;
      let offset = 0;
      let copied = 0;

      for (;;) {
        // id 가 있으면 id 커서, 없으면 offset 으로 읽는다
        const [rows] = hasId
          ? await my.query(
              `SELECT ${cols.map((c) => `\`${c.name}\``).join(', ')} FROM \`${table}\`
                WHERE (? IS NULL OR id > ?) ORDER BY id LIMIT ?`,
              [lastId, lastId, BATCH_SIZE],
            )
          : await my.query(
              `SELECT ${cols.map((c) => `\`${c.name}\``).join(', ')} FROM \`${table}\` LIMIT ? OFFSET ?`,
              [BATCH_SIZE, offset],
            );
        if (rows.length === 0) break;

        const values = [];
        const tuples = rows.map((row) => {
          const slots = cols.map((c) => {
            values.push(convertValue(row[c.name], c.type));
            return `$${values.length}`;
          });
          return `(${slots.join(', ')})`;
        });
        await pg.query(`INSERT INTO "${table}" (${colList}) VALUES ${tuples.join(', ')}`, values);

        copied += rows.length;
        offset += rows.length;
        if (hasId) lastId = rows[rows.length - 1].id;
      }
      console.log(`  옮김 ${table}: ${copied}`);
    }

    // 5. 시퀀스 맞추기
    const { rows: seqRows } = await pg.query(`
      SELECT table_name, column_name, pg_get_serial_sequence(format('%I', table_name), column_name) AS seq
        FROM information_schema.columns
       WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'`);
    for (const { table_name: table, column_name: col, seq } of seqRows) {
      if (!seq || SKIP_TABLES.has(table)) continue;
      await pg.query(
        `SELECT setval($1, COALESCE((SELECT MAX("${col}") FROM "${table}"), 0) + 1, false)`,
        [seq],
      );
    }

    // 6. 행 수 대조
    const mismatches = [];
    for (const table of tables) {
      const { rows } = await pg.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
      if (rows[0].n !== sourceCounts.get(table)) {
        mismatches.push(`${table}: 원본 ${sourceCounts.get(table)} / 대상 ${rows[0].n}`);
      }
    }
    if (mismatches.length > 0) {
      await pg.query('ROLLBACK');
      console.error('행 수가 달라 되돌렸습니다:');
      mismatches.forEach((m) => console.error(`  - ${m}`));
      process.exitCode = 1;
      return;
    }

    await pg.query('COMMIT');
    console.log('\n완료: 모든 테이블 행 수가 원본과 같습니다.');
  } catch (error) {
    await pg.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await my.end();
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
