import { NotificationStatus } from './enums/notification.enum';
import { ReportTargetType } from '../report/enums/report.enum';
import {
  SanctionNotice,
  SUSPENSION_DAYS,
} from '../report/sanction/sanction.constants';

// 푸시 알림에 들어갈 제목/본문.
// 알림 목록 문구는 프론트(NotificationListItem)가 만들고, 여기 문구는 그것과 같게 맞춰둔다.

const HANGUL_SYLLABLE_START = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;
const JONGSEONG_COUNT = 28;
// 종성 인덱스 8번이 ㄹ
const JONGSEONG_RIEUL = 8;

const getLastSyllableJongseong = (text: string) => {
  const code = text.trim().slice(-1).charCodeAt(0);

  if (!(code >= HANGUL_SYLLABLE_START && code <= HANGUL_SYLLABLE_END)) {
    return 0;
  }

  return (code - HANGUL_SYLLABLE_START) % JONGSEONG_COUNT;
};

// '(으)로부터'. 받침 없거나 ㄹ받침이면 '로부터', 나머지 받침은 '으로부터'
const getFromSuffix = (name: string) => {
  const jongseong = getLastSyllableJongseong(name);

  return jongseong === 0 || jongseong === JONGSEONG_RIEUL
    ? '로부터'
    : '으로부터';
};

const toUserCode = (userCode: string) => `@${userCode.replace(/^@+/, '')}`;

const REPORT_NOTICE_TITLE = '신고 처리 안내';
const POLICY_NOTICE_TITLE = '운영정책 안내';
const NO_VIOLATION_SUFFIX = '\n운영정책 위반 사항은 확인되지 않았어요.';

// 신고 처리 알림 본문. 대상 종류마다 다르다
const REPORT_NOTICE_BODIES: Partial<
  Record<NotificationStatus, Record<ReportTargetType, string>>
> = {
  [NotificationStatus.REPORT_RESOLVED]: {
    [ReportTargetType.COMMENT]: '신고하신 댓글이 운영정책에 따라 처리되었어요.',
    [ReportTargetType.FEED]: '신고하신 피드가 운영정책에 따라 가려졌어요.',
    [ReportTargetType.LETTER]: '신고하신 편지가 운영정책에 따라 처리되었어요.',
    [ReportTargetType.USER]: '신고하신 사용자에 대한 조치가 완료되었어요.',
  },
  [NotificationStatus.REPORT_REJECTED]: {
    [ReportTargetType.COMMENT]: `신고하신 댓글을 검토했어요.${NO_VIOLATION_SUFFIX}`,
    [ReportTargetType.FEED]: `신고하신 피드를 검토했어요.${NO_VIOLATION_SUFFIX}`,
    [ReportTargetType.LETTER]: `신고하신 편지를 검토했어요.${NO_VIOLATION_SUFFIX}`,
    [ReportTargetType.USER]: `신고하신 계정을 검토했어요.${NO_VIOLATION_SUFFIX}`,
  },
  [NotificationStatus.POLICY_NOTICE]: {
    [ReportTargetType.COMMENT]: '작성하신 댓글이 운영정책에 따라 삭제되었어요.',
    [ReportTargetType.FEED]: '작성하신 피드가 운영정책에 따라 가려졌어요.',
    [ReportTargetType.LETTER]: '보내신 편지가 운영정책에 따라 삭제되었어요.',
    [ReportTargetType.USER]: '운영정책에 따라 계정 이용이 제한되었어요.',
  },
};

const getReportNoticeBody = (
  status: NotificationStatus,
  targetType?: ReportTargetType | null,
) => (targetType ? (REPORT_NOTICE_BODIES[status]?.[targetType] ?? '') : '');

// 회원 신고로 경고 · 영구 정지를 받았을 때의 운영정책 안내 첫 줄. (제재 내용이 없는 예전 안내는 위 문구)
const USER_SANCTION_NOTICE_BODY = '운영정책 위반이 확인되었어요.';

// 운영정책 안내 끝에 붙는 제재 내용. 프론트 NotificationListItem 과 같다
const getSanctionNoticeSuffix = (
  sanction?: SanctionNotice | null,
  warningCount?: number | null,
) => {
  switch (sanction) {
    case SanctionNotice.WARNING:
      return `\n경고 ${warningCount ?? 1}회가 부여되었어요.`;
    case SanctionNotice.SUSPENSION:
      return `\n경고 ${warningCount}회 누적으로 ${SUSPENSION_DAYS}일간 이용이 정지돼요.`;
    case SanctionNotice.PERMANENT:
      return warningCount
        ? `\n경고 ${warningCount}회 누적으로 계정 이용이 영구 정지돼요.`
        : '\n계정 이용이 영구 정지돼요.';
    default:
      return '';
  }
};

const getPolicyNoticeBody = (
  targetType?: ReportTargetType | null,
  sanction?: SanctionNotice | null,
  warningCount?: number | null,
) => {
  const body =
    sanction && targetType === ReportTargetType.USER
      ? USER_SANCTION_NOTICE_BODY
      : getReportNoticeBody(NotificationStatus.POLICY_NOTICE, targetType);

  return body
    ? `${body}${getSanctionNoticeSuffix(sanction, warningCount)}`
    : '';
};

export const buildPushContent = (params: {
  status: NotificationStatus;
  actorNickname?: string | null;
  actorUserCode?: string | null;
  // 팔로우 알림 본문에 들어가는 받는 사람(나) 닉네임
  recipientNickname?: string | null;
  isToSelf?: boolean;
  content?: string | null;
  eventTitle?: string | null;
  // 신고 처리 알림의 대상 종류
  targetType?: ReportTargetType | null;
  // 운영정책 안내의 제재 내용과 그때의 유효한 경고 수
  sanction?: SanctionNotice | null;
  warningCount?: number | null;
}): { title: string; body: string } => {
  const nickname = params.actorNickname ?? '';
  // 아이디가 없으면(탈퇴한 회원) 이름으로 보여준다
  const actorLabel = params.actorUserCode
    ? toUserCode(params.actorUserCode)
    : nickname;

  switch (params.status) {
    case NotificationStatus.SEND:
      return {
        title: `${nickname}에게 편지 도착 예정`,
        body: '편지가 내일 도착할 예정입니다.\n편지가 도착하기 전에 전송 여부를 확인해주세요.',
      };
    case NotificationStatus.RECEIVE:
      return {
        title: `${nickname}${params.isToSelf ? '(나)' : ''}${getFromSuffix(nickname)} 편지 도착`,
        body: '편지함을 확인해 주세요.',
      };
    case NotificationStatus.COMMENT:
      return {
        title: `${actorLabel}의 댓글`,
        body: params.content ?? '',
      };
    case NotificationStatus.REPLY:
      return {
        title: `${actorLabel}의 답글`,
        body: params.content ?? '',
      };
    case NotificationStatus.SYSTEM:
      return {
        title: '시스템 개선',
        body: '더 편리하게 이용할 수 있도록 개선했습니다.\n새롭게 달라진 기능을 확인해 보세요.',
      };
    case NotificationStatus.EVENT:
      // 광고성 정보는 제목 앞에 (광고) 표기가 필요하다 (정보통신망법 제50조)
      return {
        title: '(광고) 이벤트 알림',
        body: `${params.eventTitle ?? ''} 이벤트가 시작됐습니다.\n지금 바로 참여해 보세요.`,
      };
    case NotificationStatus.FOLLOW:
      return {
        title: `${actorLabel}님의 새로운 팔로우`,
        body: `${actorLabel}님이 ${params.recipientNickname ?? ''}님을 팔로우하기 시작했습니다.`,
      };
    case NotificationStatus.REPORT_RESOLVED:
    case NotificationStatus.REPORT_REJECTED:
      return {
        title: REPORT_NOTICE_TITLE,
        body: getReportNoticeBody(params.status, params.targetType),
      };
    case NotificationStatus.POLICY_NOTICE:
      return {
        title: POLICY_NOTICE_TITLE,
        body: getPolicyNoticeBody(
          params.targetType,
          params.sanction,
          params.warningCount,
        ),
      };
  }
};

// 야간에 미뤄둔 알림이 2개 이상일 때 아침에 한 번에 보내는 푸시. 목록에는 각 알림이 따로 남아 있다.
export const buildNightSummaryPushContent = (count: number) => ({
  title: `새로운 알림 ${count}개`,
  body: '지난밤 도착한 알림을 확인해 주세요.',
});

// 이용 제한 이의 신청 결과 푸시. 알림 목록에는 남기지 않는다 (NotificationService.sendPushOnly)
export const buildAppealResultPushContent = (isAccepted: boolean) => ({
  title: '이의 신청 결과 안내',
  body: isAccepted
    ? '이의 신청이 받아들여져 계정 이용 제한이 풀렸어요.'
    : '이의 신청을 검토했어요.\n운영정책 위반이 확인되어 이용 제한이 유지돼요.',
});
