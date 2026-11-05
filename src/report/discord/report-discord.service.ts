import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import axios from 'axios';
import { ReportContentSnapshot, ReportEntity } from '../entities/report.entity';
import {
  REPORT_REASON_LABELS,
  ReportAction,
  ReportStatus,
  ReportTargetType,
} from '../enums/report.enum';
import { Visibility } from '../../feed/enums/visibility.enum';
import { R2Service } from '../../storage/r2.service';
import { UserEntity } from '../../user/entities/user.entity';
import { isRestrictedUser } from '../../user/withdrawn-user';
import { DiscordApiService, DiscordMessageBody } from './discord-api.service';
import { toReportCustomId } from './report-custom-id';
import {
  BUTTON_STYLE,
  COMPONENT_TYPE,
  EmbedField,
  escapeMarkdown,
  toDiscordTime,
  toQuote,
  truncate,
  withDbValue,
} from './discord-format.util';

const REQUEST_TIMEOUT = 5_000;

// 처리 전 빨강, 처리(가림 · 이용 제한) 초록, 기각 회색
const STATUS_COLORS: Record<ReportStatus, number> = {
  [ReportStatus.PENDING]: 0xe5484d,
  [ReportStatus.RESOLVED]: 0x30a46c,
  [ReportStatus.REJECTED]: 0x8b8d98,
};

const ACTION_LABELS: Record<ReportAction, string> = {
  [ReportAction.BLIND]: '가림',
  [ReportAction.RESTRICT]: '이용 제한',
  [ReportAction.REJECT]: '기각 (위반 없음)',
};

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

type ContentEmbed = {
  fields: EmbedField[];
  image?: { url: string };
  thumbnail?: { url: string };
};

// 회원 신고 메시지에 보여줄 신고당한 회원의 지금 이용 제한 상태
type RestrictionState = { isRestricted: boolean; restrictedUntil: Date | null };

const asString = (value: unknown) => (typeof value === 'string' ? value : '');

const asNumber = (value: unknown) =>
  typeof value === 'number' || typeof value === 'string' ? String(value) : '-';

const asRecord = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/*
 * 신고 디스코드 알림.
 * 봇 설정(DISCORD_BOT_TOKEN · DISCORD_REPORT_CHANNEL_ID)이 있으면 봇이 처리 버튼을 단 메시지를 보내고,
 * 처리할 때마다 같은 대상의 신고 메시지를 모두 지금 상태로 고친다. (터미널로 처리해도 고친다)
 * 봇 설정이 없으면 예전처럼 웹훅(DISCORD_REPORT_WEBHOOK_URL)으로 버튼 없이 보낸다.
 * 실패해도 신고 저장 · 처리에는 영향이 없도록 에러를 밖으로 던지지 않는다.
 */
@Injectable()
export class ReportDiscordService {
  private readonly logger = new Logger(ReportDiscordService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly r2Service: R2Service,
    private readonly discordApiService: DiscordApiService,
    private readonly dataSource: DataSource,

    @InjectRepository(ReportEntity)
    private readonly reportRepository: Repository<ReportEntity>,
  ) {}

  async notifyReport(report: ReportEntity) {
    if (this.discordApiService.isBotConfigured()) {
      await this.sendBotMessage(report);
      return;
    }

    await this.sendWebhookMessage(report);
  }

  // 같은 대상의 신고 메시지를 모두 지금 상태(처리 결과 · 버튼)로 고친다
  async syncTargetMessages(targetType: ReportTargetType, targetId: number) {
    if (!this.discordApiService.isBotConfigured()) {
      return;
    }

    try {
      const reports = await this.reportRepository.find({
        where: { targetType, targetId, discordMessageId: Not(IsNull()) },
        order: { id: 'ASC' },
      });

      if (reports.length === 0) {
        return;
      }

      const restriction = await this.getRestrictionState(targetType, targetId);

      for (const report of reports) {
        try {
          await this.discordApiService.editReportMessage(
            report.discordMessageId!,
            this.buildMessage(report, restriction),
          );
        } catch (error) {
          this.logError(`신고 #${report.id} 디스코드 메시지 수정 실패`, error);
        }
      }
    } catch (error) {
      this.logError(`${targetType} #${targetId} 신고 메시지 수정 실패`, error);
    }
  }

  private async sendBotMessage(report: ReportEntity) {
    try {
      const messageId = await this.discordApiService.createReportMessage(
        this.buildMessage(report, null),
      );

      await this.reportRepository.update(
        { id: report.id },
        { discordMessageId: messageId },
      );
    } catch (error) {
      this.logError(`신고 #${report.id} 디스코드 알림 실패`, error);
    }
  }

  private async sendWebhookMessage(report: ReportEntity) {
    const webhookUrl = this.configService.get<string>(
      'DISCORD_REPORT_WEBHOOK_URL',
    );

    if (!webhookUrl) {
      this.logger.warn(
        `디스코드 봇 설정과 DISCORD_REPORT_WEBHOOK_URL 이 모두 없어 신고 #${report.id} 알림을 보내지 않았습니다.`,
      );
      return;
    }

    try {
      // 웹훅으로 보낸 메시지에는 누를 수 있는 버튼을 달 수 없다
      const { embeds, allowed_mentions } = this.buildMessage(report, null);

      await axios.post(
        webhookUrl,
        { embeds, allowed_mentions },
        { timeout: REQUEST_TIMEOUT },
      );
    } catch (error) {
      // 에러 객체에는 웹훅 주소가 들어 있어서 메시지만 남긴다
      this.logError(`신고 #${report.id} 디스코드 알림 실패`, error);
    }
  }

  private buildMessage(
    report: ReportEntity,
    restriction: RestrictionState | null,
  ) {
    // 막 저장한 신고는 기본값(status)이 엔티티에 채워지지 않았을 수 있다
    const status = report.status ?? ReportStatus.PENDING;
    const content = this.toContentEmbed(
      report.targetType,
      report.contentSnapshot,
    );

    return {
      // 신고 내용에 @everyone 같은 멘션이 있어도 아무도 호출되지 않게 막는다
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: `새 신고 #${report.id}`,
          color: STATUS_COLORS[status],
          fields: [
            {
              name: '처리',
              value: this.toHandlingText(report, status, restriction),
            },
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
          timestamp: new Date(report.createdAt ?? Date.now()).toISOString(),
        },
      ],
      components: this.buildButtons(report, status),
    } satisfies DiscordMessageBody;
  }

  // '처리 전' 또는 '가림 · @운영자 · 시각'
  private toHandlingText(
    report: ReportEntity,
    status: ReportStatus,
    restriction: RestrictionState | null,
  ) {
    if (status === ReportStatus.PENDING || !report.action) {
      return '처리 전';
    }

    let actionLabel = ACTION_LABELS[report.action];

    if (report.action === ReportAction.RESTRICT && restriction) {
      actionLabel += !restriction.isRestricted
        ? ' (끝남)'
        : restriction.restrictedUntil
          ? ` (${toDiscordTime(restriction.restrictedUntil)} 까지)`
          : ' (영구)';
    }

    // 임베드 안의 멘션은 알림이 가지 않는다
    const handler = report.handledBy ? `<@${report.handledBy}>` : '터미널';
    const handledAt = report.handledAt
      ? ` · ${toDiscordTime(report.handledAt)}`
      : '';

    return `${actionLabel} · ${handler}${handledAt}`;
  }

  // 처리 전: 가리기(회원은 이용 제한) · 기각. 처리 후: 되돌리기
  private buildButtons(report: ReportEntity, status: ReportStatus) {
    const reportId = Number(report.id);
    const buttons =
      status === ReportStatus.PENDING
        ? [
            report.targetType === ReportTargetType.USER
              ? {
                  label: '이용 제한',
                  style: BUTTON_STYLE.DANGER,
                  custom_id: toReportCustomId('restrict', reportId),
                }
              : {
                  label: '가리기',
                  style: BUTTON_STYLE.DANGER,
                  custom_id: toReportCustomId('blind', reportId),
                },
            {
              label: '기각',
              style: BUTTON_STYLE.SECONDARY,
              custom_id: toReportCustomId('reject', reportId),
            },
          ]
        : [
            {
              label: '되돌리기',
              style: BUTTON_STYLE.SECONDARY,
              custom_id: toReportCustomId('undo', reportId),
            },
          ];

    return [
      {
        type: COMPONENT_TYPE.ACTION_ROW,
        components: buttons.map((button) => ({
          type: COMPONENT_TYPE.BUTTON,
          ...button,
        })),
      },
    ];
  }

  private async getRestrictionState(
    targetType: ReportTargetType,
    targetId: number,
  ): Promise<RestrictionState | null> {
    if (targetType !== ReportTargetType.USER) {
      return null;
    }

    const user = await this.dataSource.getRepository(UserEntity).findOne({
      select: { id: true, restrictedAt: true, restrictedUntil: true },
      where: { id: targetId },
    });

    return user
      ? {
          isRestricted: isRestrictedUser(user),
          restrictedUntil: user.restrictedUntil,
        }
      : null;
  }

  // 에러 객체에는 토큰 · 웹훅 주소가 들어 있어서 메시지만 남긴다
  private logError(message: string, error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.error(`${message}: ${detail}`);
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
