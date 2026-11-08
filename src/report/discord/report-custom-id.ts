// 신고 메시지 버튼의 custom_id. 'report:<처리 방법>:<신고 번호>[:confirm]'
// blind: 가리기 + 경고, warn: 경고(회원 신고), ban: 영구 정지, reject: 기각, undo: 되돌리기, withdraw: 영구 정지된 회원 탈퇴
// restrict: 예전 메시지에 남아 있는 이용 제한(기간 선택) 버튼. 지금은 누르면 메시지를 새 버튼으로 고치기만 한다
export const REPORT_BUTTON_ACTIONS = [
  'blind',
  'warn',
  'ban',
  'reject',
  'undo',
  'withdraw',
  'restrict',
] as const;

export type ReportButtonAction = (typeof REPORT_BUTTON_ACTIONS)[number];

// 되돌리기 어렵거나 무거운 처리. 먼저 누르면 나만 보이는 확인 버튼을 띄우고, confirm 이 붙은 버튼을 누르면 처리한다
export const CONFIRM_REQUIRED_ACTIONS = ['ban', 'withdraw'] as const;

export type ConfirmRequiredAction = (typeof CONFIRM_REQUIRED_ACTIONS)[number];

export const isConfirmRequired = (
  action: ReportButtonAction,
): action is ConfirmRequiredAction =>
  CONFIRM_REQUIRED_ACTIONS.includes(action as ConfirmRequiredAction);

const CUSTOM_ID_PREFIX = 'report';
const CONFIRM_SUFFIX = 'confirm';

export const toReportCustomId = (
  action: ReportButtonAction,
  reportId: number,
  isConfirmed = false,
) =>
  [CUSTOM_ID_PREFIX, action, reportId, isConfirmed ? CONFIRM_SUFFIX : null]
    .filter((part) => part !== null)
    .join(':');

export const parseReportCustomId = (customId: string) => {
  const [prefix, action, reportIdPart, suffix] = customId.split(':');
  const reportId = Number(reportIdPart);

  if (
    prefix !== CUSTOM_ID_PREFIX ||
    !REPORT_BUTTON_ACTIONS.includes(action as ReportButtonAction) ||
    !Number.isInteger(reportId) ||
    reportId <= 0
  ) {
    return null;
  }

  return {
    action: action as ReportButtonAction,
    reportId,
    isConfirmed: suffix === CONFIRM_SUFFIX,
  };
};
