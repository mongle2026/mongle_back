import { BadRequestException } from '@nestjs/common';

/*
 * 추천 피드 커서. 앱은 값을 열어 보지 않고 다음 요청에 그대로 넘긴다 (base64url JSON).
 * 추천 순서는 요청마다 다시 계산하므로 feedId 커서를 쓸 수 없다.
 *
 * s: 이번 탐색을 시작한 시각(ms). 로그인했으면 이 시각 뒤에 내려준 글(feed_impression)은 다음 페이지에서 뺀다
 * o: 지금까지 내려준 개수. 로그인하지 않았으면 순서가 늘 같아서 이만큼 건너뛴다
 * r: 직전 페이지 끝의 feedId 몇 개. 페이지가 바뀌어도 같은 작성자 · 음악 간격 규칙을 이어 간다
 */
export interface RecommendationCursor {
  s: number;
  o: number;
  r: number[];
}

export function encodeRecommendationCursor(cursor: RecommendationCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeRecommendationCursor(value: string): RecommendationCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<RecommendationCursor>;

    const isValid =
      Number.isSafeInteger(parsed.s) &&
      Number.isSafeInteger(parsed.o) &&
      (parsed.o ?? -1) >= 0 &&
      Array.isArray(parsed.r) &&
      parsed.r.length <= 10 &&
      parsed.r.every(id => Number.isSafeInteger(id));

    if (!isValid) {
      throw new Error('invalid cursor');
    }

    return parsed as RecommendationCursor;
  } catch {
    throw new BadRequestException('cursor 값이 올바르지 않습니다.');
  }
}
