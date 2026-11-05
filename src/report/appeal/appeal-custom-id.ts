// 이의 신청 메시지 버튼의 custom_id. 'appeal:<처리 방법>:<이의 신청 번호>'
// accept: 제한 풀기, reject: 기각
export const APPEAL_BUTTON_ACTIONS = ['accept', 'reject'] as const;

export type AppealButtonAction = (typeof APPEAL_BUTTON_ACTIONS)[number];

const CUSTOM_ID_PREFIX = 'appeal';

export const toAppealCustomId = (
  action: AppealButtonAction,
  appealId: number,
) => [CUSTOM_ID_PREFIX, action, appealId].join(':');

// 이의 신청 버튼이 아니면 null (신고 버튼은 report-custom-id.ts 로 읽는다)
export const parseAppealCustomId = (customId: string) => {
  const [prefix, action, appealIdPart] = customId.split(':');
  const appealId = Number(appealIdPart);

  if (
    prefix !== CUSTOM_ID_PREFIX ||
    !APPEAL_BUTTON_ACTIONS.includes(action as AppealButtonAction) ||
    !Number.isInteger(appealId) ||
    appealId <= 0
  ) {
    return null;
  }

  return { action: action as AppealButtonAction, appealId };
};
