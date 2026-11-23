import { ReportContentSnapshot } from './entities/report.entity';
import { ReportTargetType } from './enums/report.enum';

// 신고 결과 화면의 대상 카드에 보여줄 미리보기 길이. 카드는 한 줄만 보여준다.
// notification.target_preview · user_sanction.content_preview 컬럼 길이와 같다
export const REPORT_PREVIEW_MAX_LENGTH = 100;

/*
 * 신고 당시 내용(report.content_snapshot)에서 대상 카드에 보여줄 글을 꺼낸다.
 * 피드 · 편지는 기록 글(text), 댓글은 내용(content). 회원 신고이거나 글이 없으면 null.
 * 이모지가 중간에 잘리지 않게 글자(코드 포인트) 단위로 자른다 (PostgreSQL VARCHAR 길이도 글자 단위)
 */
export const getReportPreview = (
  targetType: ReportTargetType,
  snapshot: ReportContentSnapshot | null | undefined,
): string | null => {
  if (!snapshot || targetType === ReportTargetType.USER) {
    return null;
  }

  const text =
    targetType === ReportTargetType.COMMENT ? snapshot.content : snapshot.text;

  if (typeof text !== 'string' || text.length === 0) {
    return null;
  }

  const chars = Array.from(text);

  return chars.length > REPORT_PREVIEW_MAX_LENGTH
    ? chars.slice(0, REPORT_PREVIEW_MAX_LENGTH).join('')
    : text;
};
