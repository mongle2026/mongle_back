/*
 * 두 사람 사이에 차단이 있는지 (누가 차단했든). 글 · 댓글 · 편지 쿼리에 조건으로 붙인다.
 * userA / userB 는 SQL 식 그대로 들어간다 (':userId', '$1', 'record.user_id' 같은 컬럼 이름).
 * 바깥 별칭의 속성 이름은 바뀌지 않으니 컬럼 이름으로 쓴다.
 * raw SQL 에서는 '$1' 처럼 번호 자리를 넘긴다. 같은 번호는 여러 번 써도 값은 한 번만 넣으면 된다.
 *
 * since: 이 시각(SQL 식) 이전에 차단한 경우만 본다. 편지처럼 차단한 뒤에 온 것만 숨기고
 * 그 전에 받은 것은 그대로 보여 줄 때 쓴다. 없으면 언제 차단했든 본다 (글).
 */
export const blockedBetweenSql = (
  userA: string,
  userB: string,
  since?: string,
) => `EXISTS (
  SELECT 1 FROM user_block
  WHERE (
      (user_block.blocker_id = ${userA} AND user_block.blocked_id = ${userB})
      OR (user_block.blocker_id = ${userB} AND user_block.blocked_id = ${userA})
    )${since ? `\n    AND user_block.created_at <= ${since}` : ''}
)`;

export const notBlockedBetweenSql = (
  userA: string,
  userB: string,
  since?: string,
) => `NOT ${blockedBetweenSql(userA, userB, since)}`;
