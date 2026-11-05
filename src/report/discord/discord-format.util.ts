// 디스코드 메시지(신고 · 이의 신청)를 만들 때 같이 쓰는 표기 · 상수

// 디스코드 embed 필드 값은 1024자까지 받는다
const FIELD_VALUE_MAX_LENGTH = 1024;

// 디스코드 메시지 구성 요소 종류 · 버튼 색
export const COMPONENT_TYPE = { ACTION_ROW: 1, BUTTON: 2 } as const;
export const BUTTON_STYLE = { SECONDARY: 2, SUCCESS: 3, DANGER: 4 } as const;

export type EmbedField = { name: string; value: string; inline?: boolean };

export const truncate = (value: string, maxLength = FIELD_VALUE_MAX_LENGTH) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

// '한글 (DB 값)'. 라벨이 없는 값이 오면 DB 값만 보여준다
export const withDbValue = (labels: Record<string, string>, value: string) =>
  labels[value] ? `${labels[value]} (${value})` : value;

// 디스코드가 보는 사람의 시간대로 보여주는 시각 표기
export const toDiscordTime = (date: Date) =>
  `<t:${Math.floor(new Date(date).getTime() / 1000)}:f>`;

// 회원이 쓴 글의 마크다운(굵게, 링크, 제목 등)이 적용되지 않고 쓴 그대로 보이게 한다
export const escapeMarkdown = (text: string) =>
  text.replace(/[\\`*_~|[\]<]/g, '\\$&').replace(/^(\s*)([#>+-])/gm, '$1\\$2');

// 줄마다 인용(>)을 붙여 다른 필드와 구분하고, 실제 줄바꿈 그대로 보이게 한다
export const toQuote = (text: string) => {
  const quoted = escapeMarkdown(text.trim())
    .split('\n')
    .map((line) => `> ${line || '​'}`)
    .join('\n');

  return truncate(quoted || '> -');
};
