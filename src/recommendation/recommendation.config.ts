/*
 * 추천 피드 설정. 가중치 · 비율 · 기간을 바꿀 때는 이 파일만 고치면 된다.
 * 각 값이 무엇에 쓰이는지는 src/recommendation/README.md 의 "가중치 조정 가이드"에 있다.
 *
 * 점수는 서로 다른 버킷(팔로우 · 선호도 · 인기)끼리 비교하지 않는다.
 * 같은 버킷 안에서 순서를 정하는 데만 쓰이므로 절대값보다 항목 사이의 비율이 중요하다.
 */
export const RECOMMENDATION_CONFIG = {
  // 한 페이지에 섞는 비율 (합이 1 이 되게). 로그인하지 않았으면 인기 100%
  mix: {
    following: 0.3,
    preference: 0.6,
    popular: 0.1,
  },

  // 추천 후보로 볼 글. 최근 windowDays 일 안에 쓴 글 중 최신 poolSize 개까지만 본다
  candidate: {
    windowDays: 60,
    poolSize: 1000,
  },

  // 인기 순위. windowDays 일 안의 반응만 센다 ("주 내로")
  popular: {
    windowDays: 7,
    weights: {
      // 1건당 점수
      like: 5,
      // 글쓴이 본인 댓글은 세지 않는다
      comment: 4,
      bookmark: 3,
      // 같은 음악이 windowDays 안에 편지에 담긴 횟수 1건당
      letterMusic: 2,
      // 애플뮤직 차트 1위 곡의 점수. 순위가 내려갈수록 0 에 가깝게 줄어든다
      appleChart: 2,
    },
  },

  // 선호도 순위
  preference: {
    // 이 기간 안의 기록 · 반응 · 재생만 취향으로 본다
    windowDays: 180,
    // 취향 신호 1건당 점수 (기획 우선순위 1 → 4)
    signalWeights: {
      // 1. 직접 기록한 음악 (피드 · 편지)
      ownRecord: 4,
      // 2. 재생해 보고 좋아요 · 북마크 · 댓글도 남긴 글의 음악
      playedAndInteracted: 3,
      // 3. 좋아요 · 북마크 · 댓글 남긴 글의 음악
      interacted: 2,
      // 4. 재생만 해 본 음악
      played: 1,
    },
    // 행동 기록(user_event)으로 신호를 거르는 기준
    engagement: {
      // 상세에 머문 시간 합이 이 이상인 글은 "반응을 남긴 글"(signalWeights.interacted)로 친다.
      // 쓰지 않으려면 아주 큰 값(예: Number.MAX_SAFE_INTEGER)으로 둔다
      detailViewMinMs: 15_000,
      // 틀어 본 곡이라도 들은 시간 합이 이보다 짧으면 "재생해 본 음악"에서 뺀다 (틀자마자 끈 곡)
      listenMinMs: 10_000,
    },
    // 후보 글이 취향과 어떻게 겹치는지에 대한 점수 (각 항목은 0~1 로 맞춘 뒤 곱한다)
    matchWeights: {
      sameMusic: 3,
      sameArtist: 2,
      sameGenre: 1,
    },
    // 취향 신호가 이보다 적으면 선호도 비중을 0 으로 두고 그만큼 인기 순위로 채운다
    minSignals: 3,
    // 취향 신호가 이만큼 쌓이면 선호도 비중을 mix.preference 그대로 쓴다. 그 사이는 비례해서 늘린다
    fullSignals: 15,
    // 오래된 글일수록 점수를 줄인다. 이 일수가 지나면 점수가 절반
    freshnessHalfLifeDays: 14,
  },

  // 신규 가입 회원 (user.created_at 기준)
  newUser: {
    // 가입하고 이 일수가 지나지 않았으면 신규 회원
    days: 14,
    // 신규 회원이고 취향 신호가 preference.fullSignals 보다 적으면 인기 비중을 최소 이만큼 둔다.
    // 모자란 만큼은 선호도 몫에서, 그래도 모자라면 팔로우 몫에서 가져온다. 0 이면 끔
    minPopularShare: 0.5,
  },

  following: {
    // 팔로우한 사람 글은 최신순에 가깝게. 이 일수가 지나면 점수가 절반
    freshnessHalfLifeDays: 3,
  },

  // 같은 작성자 · 같은 음악 글 사이에 최소 몇 개를 둘지
  spacing: {
    sameAuthorGap: 2,
    sameMusicGap: 2,
  },

  // 이미 노출된 글 (추천 API 가 내려준 글)
  seen: {
    // 이전 접속에서 이미 내려준 글은 점수에 이 값을 곱한다
    penalty: 0.2,
    // 첫 페이지(새로고침)에는 이미 내려준 글을 올리지 않는다. 볼 글이 모자랄 때만 맨 뒤에 채운다
    excludeOnFirstPage: true,
    // 노출 기록 보관 기간. 지나면 지우고, 다시 안 본 글로 친다
    retentionDays: 30,
  },

  // 취향 비교에서 빼는 장르. 대부분의 곡에 붙는 이름이라 겹쳐도 의미가 없다
  excludedGenres: ['음악', 'Music'],
} as const;

export type RecommendationConfig = typeof RECOMMENDATION_CONFIG;
