/*
 * 두 사람 사이에 차단이 있는지 (누가 차단했든). 글 · 댓글 · 편지 · 알림 쿼리에 조건으로 붙인다.
 * userA / userB 는 SQL 식 그대로 들어간다 (':userId', '?', 'record.user_id' 같은 컬럼 이름).
 * 바깥 별칭의 속성 이름은 바뀌지 않으니 컬럼 이름으로 쓴다.
 * '?' 를 넘기면 자리가 두 번 들어가므로 값도 두 번 넣는다 (userA, userB, userB, userA 순).
 */
export const blockedBetweenSql = (userA: string, userB: string) => `EXISTS (
  SELECT 1 FROM user_block
  WHERE (user_block.blocker_id = ${userA} AND user_block.blocked_id = ${userB})
    OR (user_block.blocker_id = ${userB} AND user_block.blocked_id = ${userA})
)`;

export const notBlockedBetweenSql = (userA: string, userB: string) =>
  `NOT ${blockedBetweenSql(userA, userB)}`;
