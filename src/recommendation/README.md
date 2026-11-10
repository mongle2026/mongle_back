# 추천 피드

사용자가 관심 있는 음악, 흥미롭게 읽은 글과 비슷한 글을 더 많이 만나도록 피드 순서를 정한다.

## 지금 상태 (2026-11-11)

| 항목 | 상태 |
| --- | --- |
| 앱 "추천" 탭 | **추천 알고리즘** `GET /feed/recommended` |
| 앱 "최신" 탭 (새로 추가) | 최신순 `GET /feed` (예전 추천 탭과 같은 목록) |
| 앱 "팔로잉" 탭 | 그대로 `GET /feed/following` |
| 재생 기록 (`music_play`) | 피드 · 보관함 · 편지에서 새 곡을 틀 때 `POST /music/:musicId/play` (글쓰기 화면 제외) |
| 노출 기록 (`feed_impression`) | 추천 API 가 내려준 글을 서버가 기록 |
| 행동 기록 (`user_event`) | 피드 상세 체류 · 음악 들은 시간(앱 → `POST /events`), 좋아요 · 북마크와 취소(서버) |
| 추천 점수에 쓰는 데이터 | 기록 · 좋아요 · 북마크 · 댓글 · 재생 · 노출 · 편지 · 애플뮤직 차트 + **상세 체류 시간 · 음악 들은 시간** ([행동 기록을 쓰는 방식](#행동-기록을-추천에-쓰는-방식)) |

### 배포할 때 (순서 중요)

1. **서버 배포 + 운영 DB 마이그레이션.** 운영은 `synchronize` 가 꺼져 있어서 테이블이 저절로 안 생긴다.
   ```bash
   npm run migration:run
   ```
   - `1792700000000-CreateRecommendationLogs`: `music_play`, `feed_impression`
   - `1792800000000-CreateUserEventAndRecordCreatedAtIndex`: `user_event`, `record.created_at` 인덱스
   - `1792900000000-AddUserCreatedAt`: `user.created_at` (가입일시). 이전 회원은 모두 2026-11-10 00:00(KST)

   이 테이블이 없으면 추천 피드 · 재생 기록 · `/events` 가 500 을 준다 (좋아요 · 북마크는 영향 없음, 기록만 빠진다).
   개발 DB 는 `start:dev` 때 synchronize 로 생기거나 같은 마이그레이션으로 만든다 (이미 있으면 건너뛴다).
2. **그다음 앱 배포.** 새 앱은 위 API 들이 있어야 동작한다. 옛 앱은 계속 `GET /feed` 를 추천 탭으로 쓰므로 서버를 먼저 올려도 문제없다.

## 파일

```
서버 (C:/mongle_back)
src/recommendation/
  recommendation.config.ts   ← 가중치 · 비율 · 기간. 튜닝은 이 파일만 고친다
  recommendation.service.ts  ← 후보 조회 · 점수 계산 · 비율 결정 · 노출/재생 기록 · 노출 기록 정리 크론(04:50)
  recommendation-mixer.ts    ← 한 페이지 섞기 (비율 · 간격 규칙). DB 없는 순수 함수
  recommendation-cursor.ts   ← 추천 피드용 커서 (문자열)
  entities/music-play.entity.ts      ← 재생해 본 음악 (회원 · 음악마다 한 줄)
  entities/feed-impression.entity.ts ← 추천 피드가 내려준 글 (회원 · 글마다 한 줄)
src/user-event/
  enums/user-event.enum.ts   ← 이벤트 종류와 칸 설명
  user-event.service.ts      ← 기록 저장 · 정리 크론(05:10, 90일)
  user-event.controller.ts   ← POST /events
src/feed/feed.service.ts      getRecommendedFeeds(), 좋아요/북마크에서 서버 이벤트 기록
src/feed/feed.controller.ts   GET /feed/recommended
src/music/music.controller.ts POST /music/:musicId/play

앱 (C:/mongle_front_v2)
features/feed/constants.js              ← 탭 3개와 탭별 API 경로 (FEED_PATH_BY_TAB)
features/feed/home/hooks/useFeedHome.js ← 탭별 목록. 추천 목록 캐시 규칙
features/feed/home/FeedHomeScreen.jsx   ← 탭 화면. 글 작성 직후 최신 탭으로 이동
features/write/record/hooks/useCreateFeed.js ← 새 글을 최신 목록 맨 앞에 넣는다
shared/analytics/eventQueue.js          ← 행동 기록을 모아 POST /events, 재생 기록 POST /feed/:id/play
shared/analytics/musicListenTracker.js  ← 음악 들은 시간 재기
shared/analytics/useFeedDetailDwell.js  ← 피드 상세 체류 시간 재기
shared/hooks/useFeedMusicPlayback.js    ← 재생 훅. 위 두 기록을 여기서 부른다
```

## 동작 방식

요청 한 번마다 아래를 처음부터 다시 계산한다 (미리 계산해 두는 테이블 없음).

1. **후보**: 최근 60일 안의 글 중 최신 1000개. 볼 수 있는 글만 (전체 공개 + 팔로우한 사람의 팔로워 공개).
   내 글, 차단 관계, 이용 제한 · 탈퇴 회원, 가린 글은 뺀다.
2. **점수**: 후보마다 세 가지 점수를 따로 매긴다.
   - **팔로우 점수**: 팔로우한 사람 글이면 신선도 (3일마다 절반)
   - **선호도 점수**: 내 취향 프로필과 음악 · 아티스트 · 장르가 겹치는 정도 × 신선도 (14일마다 절반)
   - **인기 점수**: 최근 7일 반응 수 × 가중치 + 그 음악이 최근 7일 편지에 담긴 횟수 + 애플뮤직 차트 순위
3. **버킷**: 점수가 0 보다 큰 글이 각 버킷(팔로우 / 선호도 / 인기)에 점수순으로 들어간다. 한 글이 여러 버킷에 있을 수 있다.
4. **비율 결정**: 기본 팔로우 30 / 선호도 60 / 인기 10. 데이터가 부족하면 아래 규칙대로 바뀐다.

   | 회원 | 팔로우 | 선호도 | 인기 |
   | --- | --- | --- | --- |
   | 데이터 충분 (신호 15개 이상) | 30 | 60 | 10 |
   | 기존 회원, 신호 9개 | 30 | 36 | 34 |
   | 신규 회원, 신호 9개 | 30 | 20 | 50 |
   | 신호 3개 미만 (신규 · 기존 같음) | 30 | 0 | 70 |
   | 팔로우한 사람 글이 없음, 신호 9개 | 0 | 51 | 49 |
   | 로그인 안 함 | 0 | 0 | 100 |
5. **섞기** (`mixFeed`): 자리마다 비율보다 덜 뽑힌 버킷에서 가장 높은 글을 고른다.
   같은 작성자 · 같은 음악이 바로 앞 2개 안에 있으면 건너뛴다. 이미 뽑힌 글은 다른 버킷에서 다시 안 나온다.
   버킷이 모두 바닥나면 나머지 글을 최신순으로 채운다.
6. **노출 기록**: 로그인 회원이면 내려준 글을 `feed_impression` 에 남긴다.
   같은 탐색(커서)의 다음 페이지에서는 이 글들을 다시 주지 않는다.

### 기획 → 구현 대응

| 기획 | 구현 |
| --- | --- |
| 인기 1. 주 내 좋아요 수 | `popular.weights.like` × 최근 7일 좋아요 수 |
| 인기 2. 주 내 댓글 수 (본인 댓글 미포함) | `popular.weights.comment` × 최근 7일 댓글 수. 글쓴이 본인 댓글 · 삭제/가린 댓글 제외 |
| 인기 3. 주 내 북마크 수 | `popular.weights.bookmark` × 최근 7일 북마크 수 |
| 인기 4. 주 내 편지에 많이 담긴 음악의 글 | `popular.weights.letterMusic` × 그 음악이 최근 7일 편지에 담긴 횟수 |
| 인기 5. 애플뮤직 인기곡 순위 | `popular.weights.appleChart` × (1위 1.0 → 50위 0.02). `popular_music` 테이블 (매일 04:00 갱신) |
| 선호 1. 직접 기록한 음악 | `signalWeights.ownRecord`. 피드 · 편지 모두 (record 테이블) |
| 선호 2. 재생 + 반응 남긴 글의 음악 | `signalWeights.playedAndInteracted` |
| 선호 3. 반응 남긴 글의 음악 | `signalWeights.interacted`. 반응 = 좋아요 · 북마크 · 댓글 · **상세를 15초 이상 읽음**. 글 하나당 한 번 |
| 선호 4. 재생해 본 음악 | `signalWeights.played`. 피드 · 보관함(내 글) · 편지에서 틀어 본 곡(`music_play`, 글쓰기 화면 제외) 중 **들은 시간 합이 10초 미만인 곡은 뺀다** |
| 음악 자체 · 장르 · 아티스트 | `matchWeights.sameMusic / sameArtist / sameGenre` |
| 팔로우 30 / 선호 60 / 인기 10 | `mix` |
| 같은 작성자 · 같은 음악 사이 최소 2개 | `spacing` (페이지가 바뀌어도 이어서 지킨다) |
| 이미 노출된 글은 상단에 올리지 않음 | 새로고침(첫 페이지)에서는 빼고, 볼 글이 모자랄 때만 맨 뒤에. 이후 페이지에서는 점수 × `seen.penalty` |
| 본인 게시물 제외 | 후보 쿼리에서 뺀다 |
| 로그인 안 함 → 인기 100% | 전체 공개 글만, 인기 버킷 하나 |
| 팔로우가 없거나 부족 → 선호 · 인기 늘림 | 팔로우 후보가 없으면 팔로우 몫 0. 중간에 바닥나면 남은 버킷끼리 비율대로 나눔 |
| 선호도 데이터가 적음 → 인기 늘림 | 취향 신호 수 < `minSignals` 이면 선호도 0, `fullSignals` 까지 비례. 줄어든 몫은 인기로 |
| 신규 가입 + 데이터 부족 → 인기 늘림 | 가입 `newUser.days`(14일) 이내이고 취향 신호가 `fullSignals` 미만이면 인기 몫을 최소 `newUser.minPopularShare`(50%)로. 모자란 만큼 선호도 → 팔로우 몫에서 가져온다 |

## 앱 쪽 규칙

- **탭**: 추천 / 최신 / 팔로잉. 최신 · 팔로잉 목록은 탭을 처음 열 때 그리고, 추천 첫 페이지가 뜬 뒤 한가할 때 미리 받아 둔다.
- **추천 목록은 저절로 다시 받지 않는다** (`staleTime: Infinity`, 재연결 때도 안 받음).
  처음부터 다시 받으면 이미 본 글이 빠지고 순서가 새로 섞여서, 보던 글이 사라지기 때문이다.
  당겨서 새로고침하면 첫 페이지만 남기고 새로 받는다 (`useFeedList` 의 `resetPagesOnRefresh`).
- **커서는 문자열이다.** `nextCursor` 를 그대로 다음 요청에 넘긴다 (`withCursor`). 숫자로 바꾸거나 feedId 와 비교하면 안 된다.
- **글 작성 직후**: 추천 · 팔로잉에는 내 글이 없으므로 최신 탭으로 옮기고 새 글을 최신 목록 맨 앞에 넣는다.
- **팔로우 상태**는 추천 · 최신 목록 모두에 반영한다 (`feedCache.js writeFollowState`).

## 수집하는 데이터

| 무엇 | 어디에 | 언제 쌓이나 | 보관 |
| --- | --- | --- | --- |
| 노출된 글 | `feed_impression` (user_id, feed_id, served_at) | 추천 API 가 글을 내려줄 때 (서버) | 30일 |
| 재생해 본 음악 | `music_play` (user_id, music_id, play_count, last_played_at) | 피드 · 보관함 · 편지에서 새 곡을 틀 때 (앱) | 계속 |
| 피드 상세 체류 시간 | `user_event` `FEED_DETAIL_VIEW` · `duration_ms` | 상세를 떠날 때 · 앱이 백그라운드로 갈 때 (앱) | 90일 |
| 음악 들은 시간 · 멈춘 지점 · 이유 | `user_event` `MUSIC_LISTEN` · `music_id` · `duration_ms` · `position_ms` · `detail`(PAUSE/END/SWITCH/STOP) | 피드 · 보관함 · 편지에서 소리가 멈출 때 (앱) | 90일 |
| 좋아요 / 취소 시각 | `user_event` `LIKE` / `UNLIKE` | 실제로 바뀌었을 때 (서버) | 90일 |
| 북마크 / 취소 시각 | `user_event` `BOOKMARK` / `UNBOOKMARK` | 실제로 바뀌었을 때 (서버) | 90일 |
| 댓글 작성 / 삭제 시각 | `feed_comment.created_at` / `deleted_at` (원래 있던 칸) | 댓글 작성 · 삭제 | 삭제 후 30일 뒤 행이 지워진다 |
| 피드 메인 체류 시간 · 실제로 화면에 보인 글 | **수집 안 함** | | |

- 앱 이벤트는 로그인했을 때만 모은다. 20개가 모이거나, 30초가 지나거나, 앱이 백그라운드로 가면 한 번에 보낸다 (최대 50개씩).
- `user_event.feed_id` 에는 FK 가 없다. 글이 지워져도 기록은 남고, `music_id` 도 같이 적어 둔다.
- **재생 기록은 음악 id 로만 남긴다.** 어디서(피드 · 보관함 내 글 · 편지) 틀었는지는 추천에 필요 없어서 남기지 않는다
  (`MUSIC_LISTEN` 의 `feed_id` 는 비어 있다). 앱은 재생 버튼을 누를 때 `handlePressPlayback({ feedId, previewUrl, musicId })` 로
  서버 음악 id(응답의 `music.musicId`, 편지는 `record.music.id`)를 넘기고, 넘기지 않은 화면(글쓰기)은 기록하지 않는다.
- 앱이 보낸 시각(`occurred_at`)은 서버 시각 기준 [7일 전, 지금] 안으로 맞춘다. 서버가 받은 시각은 `created_at`.
- 보관 기간은 `user-event.service.ts` 의 `USER_EVENT_RETENTION_DAYS`, `recommendation.config.ts` 의 `seen.retentionDays`.

## 가중치 조정 가이드

**`src/recommendation/recommendation.config.ts` 만 고치면 된다.** 서버를 재시작하면 바로 반영되고, 마이그레이션과 앱 수정은 필요 없다.

점수는 같은 버킷 안에서 순서를 정하는 데만 쓴다. 그래서 절대값보다 **항목 사이의 비율**이 중요하다
(예: like 5 / comment 4 를 10 / 8 로 바꿔도 결과는 같다).

| 바꾸고 싶은 것 | 고칠 곳 | 예시 |
| --- | --- | --- |
| 팔로우 · 선호 · 인기 섞는 비율 | `mix.following / preference / popular` (합 1) | 팔로우를 더 많이: `0.4 / 0.5 / 0.1` |
| 인기 순위에서 좋아요 vs 댓글 vs 북마크 무게 | `popular.weights.like / comment / bookmark` | 댓글을 더 중요하게: `comment: 8` |
| 편지에 많이 담긴 음악을 얼마나 띄울지 | `popular.weights.letterMusic` | 0 이면 끔 |
| 애플뮤직 차트 영향 | `popular.weights.appleChart` | 차트 1위 = 좋아요 몇 개 분인지로 생각 (지금 2 → 좋아요 0.4개) |
| "주 내" 기간 | `popular.windowDays` | 14 로 하면 2주 |
| 취향 신호 우선순위 (기록 > 재생+반응 > 반응 > 재생) | `preference.signalWeights` | 재생을 더 믿으려면 `played: 2` |
| 상세를 몇 초 읽어야 "반응"으로 칠지 | `preference.engagement.detailViewMinMs` | 더 엄격하게: `30_000`. 끄기: `Number.MAX_SAFE_INTEGER` |
| 몇 초 들어야 "재생해 봄"으로 칠지 | `preference.engagement.listenMinMs` | 미리듣기 절반 이상: `15_000`. 끄기(틀기만 해도 인정): `0` |
| 같은 곡 / 같은 가수 / 같은 장르 중 무엇을 더 볼지 | `preference.matchWeights` | 장르로 넓게 추천: `sameGenre: 2` |
| 취향을 며칠치 볼지 | `preference.windowDays` | 최근 취향만: 60 |
| 신호가 적은 회원이 언제부터 선호도 추천을 받을지 | `preference.minSignals`, `fullSignals` | 더 빨리: `minSignals: 1, fullSignals: 8` |
| 신규 회원 기간 · 인기 최소 비중 | `newUser.days`, `newUser.minPopularShare` | 한 달 동안 인기 위주: `days: 30, minPopularShare: 0.6`. 끄기: `minPopularShare: 0` |
| 오래된 글을 얼마나 빨리 밀어낼지 | `preference.freshnessHalfLifeDays`, `following.freshnessHalfLifeDays` | 작을수록 최신 글 위주 |
| 같은 작성자 · 같은 음악 간격 | `spacing.sameAuthorGap / sameMusicGap` | 3 이면 사이에 3개 |
| 이미 본 글을 얼마나 뒤로 보낼지 | `seen.penalty` (0~1, 작을수록 뒤로) | 0.05 |
| 새로고침 때 본 글을 빼는 규칙 끄기 | `seen.excludeOnFirstPage: false` | |
| 추천 후보 범위 | `candidate.windowDays`, `candidate.poolSize` | 글이 적은 동안은 90일 |
| 취향 비교에서 뺄 장르 | `excludedGenres` | 보관함과 같은 '음악', 'Music' |

## 행동 기록을 추천에 쓰는 방식

`user_event` 는 선호도 점수의 취향 신호(`loadPreferenceProfile`)를 더 정확하게 거르는 데 쓴다.
기획의 신호 우선순위(기록 > 재생+반응 > 반응 > 재생)는 그대로 두고, 각 칸에 무엇이 들어가는지만 바꿨다.

| 기록 | 쓰는 곳 | 규칙 |
| --- | --- | --- |
| 상세 체류 (`FEED_DETAIL_VIEW`) | 선호 3 "반응" | 한 글에 머문 시간 합이 `engagement.detailViewMinMs`(15초) 이상이면 좋아요와 같은 반응으로 친다. 재생도 했으면 선호 2 |
| 들은 시간 (`MUSIC_LISTEN`) | 선호 4 "재생" | 틀어 본 곡 중 들은 시간 합이 `engagement.listenMinMs`(10초) 미만이면 뺀다. 들은 시간 기록이 없으면(앱이 보내기 전에 종료 등) 틀어 본 것만으로 센다 |
| 좋아요 · 북마크 취소 (`UNLIKE` / `UNBOOKMARK`) | **안 쓴다** | 취소하면 `feed_like` · `bookmark` 행이 지워져서 이미 신호에서 빠진다. 취소를 감점으로 쓰면 "마음이 바뀜"을 "싫어함"으로 보게 돼 근거가 약하다. 분석용으로만 둔다 |
| 좋아요 · 북마크 (`LIKE` / `BOOKMARK`) | 안 쓴다 | 같은 내용이 `feed_like` · `bookmark` 테이블에 있다 |

보관 기간이 다르다는 점에 주의한다: 취향은 180일(`preference.windowDays`)을 보지만 `user_event` 는 90일만 남는다.
90일이 지난 체류 · 들은 시간은 신호에서 빠진다 (틀어 본 기록 `music_play` 는 남으므로 그 곡은 다시 "재생"으로 센다).

더 넣어 볼 만한 것 (지금은 안 함):
- **끝까지 들은 곡**(`detail = 'END'`)에 더 큰 무게: `signalWeights` 에 키를 추가하고 `playedRows` 에서 따로 센다.
- **인기 순위에 상세 체류**: 기획의 인기 항목에 없어서 넣지 않았다. 넣는다면 `loadCandidatePool` 에 최근 7일 체류 합 서브쿼리를 더하고 `popular.weights` 에 키를 추가한다.
- **피드 메인 체류 · 실제로 보인 글**: 수집하지 않는다. 필요하면 앱 `FeedPostList` 의 `onViewableItemsChanged` 에서
  보인 시간을 재 `eventQueue.logEvent` 로 보내고, 서버 `CLIENT_USER_EVENT_TYPES` 에 종류를 추가한다.

## 글이 많아지면

지금은 요청마다 후보 1000개를 읽고 7일 반응 수를 서브쿼리로 센다. 느려지면 순서대로 검토한다.

1. ~~`record.created_at` 인덱스~~ (추가함)
2. 인기 점수를 크론(예: 10분마다)으로 미리 계산해 테이블에 두고 읽기만
3. 취향 프로필을 회원별로 캐시 (반응 · 기록 · 재생이 생길 때만 다시 계산)
4. `candidate.poolSize` 줄이기

## 확인 방법

```bash
# 로그인 전 (인기 순위만)
curl "$API/feed/recommended?limit=10"
# 로그인 후. 다음 페이지는 응답의 nextCursor 를 그대로 넘긴다
curl -H "Authorization: Bearer $TOKEN" "$API/feed/recommended?limit=10"
curl -H "Authorization: Bearer $TOKEN" "$API/feed/recommended?limit=10&cursor=<nextCursor>"
# 재생 기록
curl -X POST -H "Authorization: Bearer $TOKEN" "$API/music/45/play"
# 행동 기록
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$API/events" \
  -d '{"events":[{"type":"MUSIC_LISTEN","musicId":45,"durationMs":4100,"positionMs":4100,"endReason":"PAUSE","occurredAt":"2026-11-11T00:00:00Z"}]}'
```

어느 버킷에서 뽑혔는지 보고 싶으면 `mixFeed` 결과의 `source` ('following' | 'preference' | 'popular' | 'fallback')를 로그로 찍는다.

## 알려진 한계

- **노출 = 서버가 내려준 글.** 스크롤하지 않아 실제로 못 본 글도 본 것으로 친다 (한 페이지 20개라 오차는 작다).
- **로그인 전 페이지 넘김은 순서(offset) 기준.** 페이지를 넘기는 사이에 인기 순위가 바뀌면 글이 겹치거나 빠질 수 있다.
- **차단하면 추천 목록이 새로 섞인다.** 차단은 피드 홈 목록을 모두 다시 받게 하는데, 추천은 다시 받으면 순서가 바뀐다.
- **후보는 최근 60일 글.** 더 오래된 글은 추천에 안 나오고 최신 탭에서 본다.
- **편지 · 차트 점수는 음악 단위.** 같은 곡을 기록한 글은 모두 같은 점수를 더 받는다.
- **글이 적으면 간격 규칙을 푼다.** 같은 작성자 글만 남았을 때 빈 페이지 대신 붙여서 보여 준다.
- **2026-11-10 전 가입자의 가입일시는 정확하지 않다.** 모두 2026-11-10 00:00(KST)로 넣어서 11-24 까지는 신규 회원으로 본다 (취향 신호가 충분하면 영향 없음).
- **글쓰기 화면의 미리듣기는 기록하지 않는다.** 검색 결과라 서버 음악 id 가 없다. 그 밖의 화면(피드 · 보관함 · 편지)은 모두 기록한다.
- **앱 이벤트는 놓칠 수 있다.** 듣는 도중에 앱이 종료되면 그 `MUSIC_LISTEN` 은 남지 않는다. 보내기 전에 앱이 종료되면 모아 둔 기록도 사라진다.
- **상세 체류는 여러 줄로 나뉠 수 있다.** 앱이 백그라운드로 갈 때마다 그때까지 잰 시간을 따로 보낸다.
