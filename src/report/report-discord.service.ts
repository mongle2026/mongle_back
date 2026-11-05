import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ReportContentSnapshot, ReportEntity } from './entities/report.entity';
import { REPORT_REASON_LABELS, ReportTargetType } from './enums/report.enum';
import { Visibility } from '../feed/enums/visibility.enum';
import { R2Service } from '../storage/r2.service';

const REQUEST_TIMEOUT = 5_000;
// 디스코드 embed 필드 값은 1024자까지 받는다
const FIELD_VALUE_MAX_LENGTH = 1024;
const EMBED_COLOR = 0xe5484d;

// 괄호 안에는 DB 에 저장된 값을 그대로 붙여서, 알림을 보고 바로 DB 에서 찾을 수 있게 한다
const TARGET_TYPE_LABELS: Record<ReportTargetType, string> = {
  [ReportTargetType.FEED]: '피드',
  [ReportTargetType.COMMENT]: '댓글',
  [ReportTargetType.LETTER]: '편지',
  [ReportTargetType.USER]: '회원',
};

const VISIBILITY_LABELS: Record<Visibility, string> = {
  [Visibility.PUBLIC]: '전체 공개',
  [Visibility.FOLLOWER]: '팔로워 공개',
  [Visibility.PRIVACY]: '나만 보기',
};

type EmbedField = { name: string; value: string; inline?: boolean };

type ContentEmbed = {
  fields: EmbedField[];
  image?: { url: string };
  thumbnail?: { url: string };
};

const truncate = (value: string, maxLength = FIELD_VALUE_MAX_LENGTH) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

// '한글 (DB 값)'. 라벨이 없는 값이 오면 DB 값만 보여준다
const withDbValue = (labels: Record<string, string>, value: string) =>
  labels[value] ? `${labels[value]} (${value})` : value;

const asString = (value: unknown) => (typeof value === 'string' ? value : '');

const asNumber = (value: unknown) =>
  typeof value === 'number' || typeof value === 'string' ? String(value) : '-';

const asRecord = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

// 회원이 쓴 글의 마크다운(굵게, 링크, 제목 등)이 적용되지 않고 쓴 그대로 보이게 한다
const escapeMarkdown = (text: string) =>
  text.replace(/[\\`*_~|[\]<]/g, '\\$&').replace(/^(\s*)([#>+-])/gm, '$1\\$2');

// 줄마다 인용(>)을 붙여 다른 필드와 구분하고, 실제 줄바꿈 그대로 보이게 한다
const toQuote = (text: string) => {
  const quoted = escapeMarkdown(text.trim())
    .split('\n')
    .map((line) => `> ${line || '​'}`)
    .join('\n');

  return truncate(quoted || '> -');
};

@Injectable()
export class ReportDiscordService {
  private readonly logger = new Logger(ReportDiscordService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly r2Service: R2Service,
  ) {}

  // 새 신고를 디스코드 채널로 알린다. 실패해도 신고 저장에는 영향이 없도록 에러를 밖으로 던지지 않는다.
  async notifyReport(report: ReportEntity) {
    const webhookUrl = this.configService.get<string>(
      'DISCORD_REPORT_WEBHOOK_URL',
    );

    if (!webhookUrl) {
      this.logger.warn(
        `DISCORD_REPORT_WEBHOOK_URL 이 없어 신고 #${report.id} 알림을 보내지 않았습니다.`,
      );
      return;
    }

    try {
      const content = this.toContentEmbed(
        report.targetType,
        report.contentSnapshot,
      );

      await axios.post(
        webhookUrl,
        {
          // 신고 내용에 @everyone 같은 멘션이 있어도 아무도 호출되지 않게 막는다
          allowed_mentions: { parse: [] },
          embeds: [
            {
              title: `새 신고 #${report.id}`,
              color: EMBED_COLOR,
              fields: [
                {
                  name: '대상',
                  value: `${withDbValue(TARGET_TYPE_LABELS, report.targetType)} #${report.targetId}`,
                  inline: true,
                },
                {
                  name: '사유',
                  value: withDbValue(REPORT_REASON_LABELS, report.reason),
                  inline: true,
                },
                {
                  name: '신고한 회원 → 신고당한 회원 (user.id)',
                  value: `${report.reporterId} → ${report.reportedUserId}`,
                },
                {
                  name: '상세',
                  value: report.detail ? toQuote(report.detail) : '-',
                },
                ...content.fields,
              ],
              ...(content.image && { image: content.image }),
              ...(content.thumbnail && { thumbnail: content.thumbnail }),
              timestamp: new Date().toISOString(),
            },
          ],
        },
        { timeout: REQUEST_TIMEOUT },
      );
    } catch (error) {
      // 에러 객체에는 웹훅 주소가 들어 있어서 메시지만 남긴다
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`신고 #${report.id} 디스코드 알림 실패: ${message}`);
    }
  }

  // 신고 당시 내용. 대상 종류마다 스냅샷 모양이 다르다 (report.service.ts 참고)
  private toContentEmbed(
    targetType: ReportTargetType,
    snapshot: ReportContentSnapshot,
  ): ContentEmbed {
    switch (targetType) {
      case ReportTargetType.FEED:
      case ReportTargetType.LETTER:
        return this.toRecordEmbed(snapshot);

      case ReportTargetType.COMMENT:
        return {
          fields: [
            {
              name: '댓글이 달린 피드 (feed.id)',
              value: `#${asNumber(snapshot.feedId)}`,
            },
            { name: '본문', value: toQuote(asString(snapshot.content)) },
          ],
        };

      case ReportTargetType.USER:
        return this.toUserEmbed(snapshot);

      default:
        return {
          fields: [
            {
              name: '신고 당시 내용',
              value: truncate(JSON.stringify(snapshot)),
            },
          ],
        };
    }
  }

  // 피드 · 편지. 편지는 공개 범위가 없다
  private toRecordEmbed(snapshot: ReportContentSnapshot): ContentEmbed {
    const music = asRecord(snapshot.music);
    const fileKeys = Array.isArray(snapshot.fileKeys)
      ? snapshot.fileKeys.filter(
          (key): key is string => typeof key === 'string' && key !== '',
        )
      : [];
    const fileUrls = fileKeys.map((key) => this.r2Service.getPublicUrl(key));
    const visibility = asString(snapshot.visibility);

    const fields: EmbedField[] = [
      {
        name: '노래',
        value: truncate(
          escapeMarkdown(
            [asString(music.title), asString(music.artist)]
              .filter(Boolean)
              .join(' · ') || '-',
          ),
        ),
        inline: true,
      },
      ...(visibility
        ? [
            {
              name: '공개 범위',
              value: withDbValue(VISIBILITY_LABELS, visibility),
              inline: true,
            },
          ]
        : []),
      {
        name: '기록 (record.id)',
        value: `#${asNumber(snapshot.recordId)}`,
        inline: true,
      },
      {
        name: '사진',
        value: fileUrls.length
          ? truncate(
              `${fileUrls.length}장 · ${fileUrls
                .map((url, index) => `[${index + 1}](${url})`)
                .join(' ')}`,
            )
          : '없음',
      },
      { name: '본문', value: toQuote(asString(snapshot.text)) },
    ];

    // embed 에는 사진을 한 장만 넣을 수 있어서 첫 장만 미리 보여준다
    return {
      fields,
      ...(fileUrls[0] && { image: { url: fileUrls[0] } }),
    };
  }

  private toUserEmbed(snapshot: ReportContentSnapshot): ContentEmbed {
    const profileImageUrl = this.r2Service.getProfileImageUrl({
      profileImageKey: asString(snapshot.profileImageKey) || null,
      defaultProfileImageNo:
        typeof snapshot.defaultProfileImageNo === 'number'
          ? snapshot.defaultProfileImageNo
          : null,
    });

    return {
      fields: [
        {
          name: '닉네임',
          value: truncate(escapeMarkdown(asString(snapshot.nickname) || '-')),
          inline: true,
        },
        {
          name: '회원 코드 (user_code)',
          value: truncate(escapeMarkdown(asString(snapshot.userCode) || '-')),
          inline: true,
        },
        {
          name: 'public_id',
          value: asString(snapshot.publicId) || '-',
        },
      ],
      ...(profileImageUrl && { thumbnail: { url: profileImageUrl } }),
    };
  }
}
