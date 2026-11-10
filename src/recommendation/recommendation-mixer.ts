/*
 * 추천 피드 한 페이지를 섞는 순수 함수. DB 를 쓰지 않는다.
 *
 * 1. 버킷(팔로우 · 선호도 · 인기)마다 점수순으로 정렬된 후보를 받는다.
 * 2. 자리마다 "비율보다 가장 덜 뽑힌" 버킷부터 본다. 그래서 30 : 60 : 10 이 페이지 안에서 고르게 퍼진다.
 *    어떤 버킷이 바닥나면 남은 버킷끼리 비율대로 나눠 채운다 (팔로우가 부족하면 선호도 · 인기가 늘어난다).
 * 3. 같은 작성자 · 같은 음악이 바로 앞 gap 개 안에 있으면 그 후보는 건너뛴다.
 * 4. 버킷에서 못 고르면 fallback(나머지 글)에서 고른다.
 *    그래도 없으면 간격 규칙을 풀고 고른다 (글이 적을 때 페이지가 비지 않도록).
 * 한 글이 여러 버킷에 있어도 한 번만 나온다.
 */

export interface MixCandidate {
  feedId: number;
  authorId: number;
  musicId: number;
}

export interface MixBucket<T extends MixCandidate = MixCandidate> {
  key: string;
  ratio: number;
  // 점수 높은 순
  items: T[];
}

export interface MixOptions<T extends MixCandidate> {
  buckets: MixBucket<T>[];
  // 버킷에서 못 고를 때 쓰는 나머지 글 (앞에 있을수록 먼저)
  fallback: T[];
  limit: number;
  // 이전 페이지 끝의 글. 페이지가 바뀌어도 간격 규칙을 이어서 지킨다 (오래된 것 → 최근 순)
  recent?: MixCandidate[];
  sameAuthorGap: number;
  sameMusicGap: number;
}

export interface MixedItem<T extends MixCandidate> {
  item: T;
  // 어느 버킷에서 뽑혔는지 ('fallback' 포함). 디버깅 · 비율 확인용
  source: string;
}

export function mixFeed<T extends MixCandidate>(
  options: MixOptions<T>,
): MixedItem<T>[] {
  const { limit, sameAuthorGap, sameMusicGap } = options;
  const buckets = options.buckets.filter(bucket => bucket.ratio > 0);
  const ratioSum = buckets.reduce((sum, bucket) => sum + bucket.ratio, 0);

  const used = new Set<number>();
  const pickedCount = new Map<string, number>();
  // 버킷마다 아직 안 본 첫 자리. 앞쪽은 이미 뽑혔거나 다른 버킷에서 쓰였다
  const cursor = new Map<string, number>();
  const history: MixCandidate[] = [...(options.recent ?? [])];
  const result: MixedItem<T>[] = [];

  const fitsSpacing = (candidate: MixCandidate) => {
    const authorWindow = history.slice(-sameAuthorGap);
    const musicWindow = history.slice(-sameMusicGap);

    return (
      !authorWindow.some(prev => prev.authorId === candidate.authorId) &&
      !musicWindow.some(prev => prev.musicId === candidate.musicId)
    );
  };

  const hasRemaining = (bucket: MixBucket<T>) => {
    let index = cursor.get(bucket.key) ?? 0;

    while (index < bucket.items.length && used.has(bucket.items[index].feedId)) {
      index++;
    }

    cursor.set(bucket.key, index);
    return index < bucket.items.length;
  };

  const findIn = (items: T[], start: number, checkSpacing: boolean) => {
    for (let i = start; i < items.length; i++) {
      const item = items[i];
      if (used.has(item.feedId)) continue;
      if (checkSpacing && !fitsSpacing(item)) continue;
      return item;
    }
    return undefined;
  };

  const pick = (item: T, source: string) => {
    used.add(item.feedId);
    history.push(item);
    pickedCount.set(source, (pickedCount.get(source) ?? 0) + 1);
    result.push({ item, source });
  };

  while (result.length < limit) {
    const position = result.length + 1;

    // 비율 대비 덜 뽑힌 버킷부터. 바닥난 버킷은 빼서 남은 버킷이 그 몫을 나눠 갖게 한다
    const ordered = buckets
      .filter(hasRemaining)
      .map(bucket => ({
        bucket,
        deficit:
          (bucket.ratio / ratioSum) * position -
          (pickedCount.get(bucket.key) ?? 0),
      }))
      .sort((a, b) => b.deficit - a.deficit)
      .map(entry => entry.bucket);

    let picked = false;

    for (const checkSpacing of [true, false]) {
      for (const bucket of ordered) {
        const item = findIn(bucket.items, cursor.get(bucket.key) ?? 0, checkSpacing);
        if (item) {
          pick(item, bucket.key);
          picked = true;
          break;
        }
      }
      if (picked) break;

      const fallbackItem = findIn(options.fallback, 0, checkSpacing);
      if (fallbackItem) {
        pick(fallbackItem, 'fallback');
        picked = true;
        break;
      }
    }

    if (!picked) break;
  }

  return result;
}
