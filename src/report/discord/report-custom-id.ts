import { RESTRICTION_DAYS, RestrictionPeriod } from '../enums/report.enum';

// 신고 메시지 버튼의 custom_id. 'report:<처리 방법>:<신고 번호>[:<이용 제한 기간>]'
// restrict 는 기간 없이 누르면 기간 선택 버튼을 띄우고, 기간이 붙은 버튼을 누르면 제한한다
export const REPORT_BUTTON_ACTIONS = [
  'blind',
  'reject',
  'restrict',
  'undo',
] as const;

export type ReportButtonAction = (typeof REPORT_BUTTON_ACTIONS)[number];

const CUSTOM_ID_PREFIX = 'report';

export const toReportCustomId = (
  action: ReportButtonAction,
  reportId: number,
  period?: RestrictionPeriod,
) =>
  [CUSTOM_ID_PREFIX, action, reportId, period]
    .filter((part) => part !== undefined)
    .join(':');

export const parseReportCustomId = (customId: string) => {
  const [prefix, action, reportIdPart, periodPart] = customId.split(':');
  const reportId = Number(reportIdPart);

  if (
    prefix !== CUSTOM_ID_PREFIX ||
    !REPORT_BUTTON_ACTIONS.includes(action as ReportButtonAction) ||
    !Number.isInteger(reportId) ||
    reportId <= 0
  ) {
    return null;
  }

  const period: RestrictionPeriod | null =
    periodPart === 'permanent'
      ? 'permanent'
      : (RESTRICTION_DAYS.find((days) => String(days) === periodPart) ?? null);

  return { action: action as ReportButtonAction, reportId, period };
};
