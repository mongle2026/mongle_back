/**
 * raw SQL 의 PostgreSQL 번호 자리($1, $2 ...)를 값과 함께 만든다.
 * 조건을 이어 붙이며 쿼리를 만들 때 자리 번호를 직접 세지 않아도 된다.
 *
 *   const sql = new SqlParams();
 *   const where = `user_id = ${sql.add(userId)}`; // 'user_id = $1'
 *   await dataSource.query(`SELECT ... WHERE ${where}`, sql.values);
 *
 * 같은 값을 여러 곳에 쓸 때는 add 한 번으로 받은 자리('$1')를 그대로 여러 번 쓰면 된다.
 */
export class SqlParams {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}
