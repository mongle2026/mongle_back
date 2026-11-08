import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
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
import {
  SanctionService,
  UserSanctionState,
} from '../sanction/sanction.service';
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

// 처리 전 빨강, 처리(가림 · 경고 · 영구 정지) 초록, 기각 회색
const STATUS_COLORS: Record<ReportStatus, number> = {
  [ReportStatus.PENDING]: 0xe5484d,
  [ReportStatus.RESOLVED]: 0x30a46c,
  [ReportStatus.REJECTED]: 0x8b8d98,
};

const ACTION_LABELS: Record<ReportAction, string> = {
  [ReportAction.BLIND]: '가림',
  [ReportAction.WARN]: '경고',
  [ReportAction.BAN]: '영구 정지',
  [ReportAction.REJECT]: '기각 (위반 없음)',
  [ReportAction.RESTRICT]: '이용 제한 (예전 방식)',
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

const asString = (value: unknown) => (typeof value === 'string' ? value : '');

const asNumber = (value: unknown) =>
  typeof value === 'number' || typeof value === 'string' ? String(value) : '-';

const asRecord = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/*
 * 신고 디스코드 알림.
 * 봇 설정(DISCORD_BOT_TOKEN · DISCORD_REPORT_CHANNEL_ID)이 있으면 봇이 처리 버튼을 단 메시지를 보내고,
 * 처리할 때마다 같은 대상의 신고 메시지와 같은 회원의 처리 전 신고 메시지를 지금 상태로 고친다. (터미널로 처리해도 고친다)
 * 메시지에는 신고당한 회원의 지금 제재 상태(유효 경고 수 · 정지)를 같이 보여준다. 메시지를 고친 시점 기준이다.
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
    private readonly sanctionService: SanctionService,

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

  /*
   * 같은 대상의 신고 메시지와, 같은 회원의 처리 전 신고 메시지를 지금 상태(처리 결과 · 제재 상태 · 버튼)로 고친다.
   * 처리 전 메시지는 운영자가 경고 수를 보고 판단하므로 함께 고친다. 이미 처리된 다른 대상의 메시지는 그대로 둔다
   */
  async syncMessages(
    targetType: ReportTargetType,
    targetId: number,
    reportedUserId: number,
  ) {
    if (!this.discordApiService.isBotConfigured()) {
      return;
    }

    try {
      const reports = await this.reportRepository.find({
        where: [
          { targetType, targetId, discordMessageId: Not(IsNull()) },
          {
            reportedUserId,
            status: ReportStatus.PENDING,
            discordMessageId: Not(IsNull()),
          },
        ],
        order: { id: 'ASC' },
      });

      if (reports.length === 0) {
        return;
      }

      const state = await this.sanctionService.getUserState(reportedUserId);

      for (const report of reports) {
        try {
          await this.discordApiService.editReportMessage(
            report.discordMessageId!,
            this.buildMessage(report, state),
          );
        } catch (error) {
          this.logError(`신고 #${report.id} 디스코드 메시지 수정 실패`, error);
        }
      }
    } catch (error) {
      this.logError(`${targetType} #${targetId} 신고 메시지 수정 실패`, error);
    }
  }

  // 신고 번호로 그 대상의 메시지를 고친다 (예전 버튼을 눌렀을 때)
  async syncByReportId(reportId: number) {
    try {
      const report = await this.reportRepository.findOne({
        select: {
          id: true,
          targetType: true,
          targetId: true,
          reportedUserId: true,
        },
        where: { id: reportId },
      });

      if (report) {
        await this.syncMessages(
          report.targetType,
          Number(report.targetId),
          Number(report.reportedUserId),
        );
      }
    } catch (error) {
      this.logError(`신고 #${reportId} 디스코드 메시지 수정 실패`, error);
    }
  }

  private async sendBotMessage(report: ReportEntity) {
    try {
      const messageId = await this.discordApiService.createReportMessage(
        this.buildMessage(
          report,
          await this.sanctionService.getUserState(
            Number(report.reportedUserId),
          ),
        ),
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
      const { embeds, allowed_mentions } = this.buildMessage(
        report,
        await this.sanctionService.getUserState(Number(report.reportedUserId)),
      );

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

  private buildMessage(report: ReportEntity, state: UserSanctionState | null) {
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
              value: this.toHandlingText(report, status),
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
              name: '신고당한 회원의 지금 제재',
              value: this.toSanctionStateText(state),
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
      components: this.buildButtons(report, status, state),
    } satisfies DiscordMessageBody;
  }

  // '처리 전' 또는 '가림 · @운영자 · 시각'
  private toHandlingText(report: ReportEntity, status: ReportStatus) {
    if (status === ReportStatus.PENDING || !report.action) {
      return '처리 전';
    }

    // 임베드 안의 멘션은 알림이 가지 않는다
    const handler = report.handledBy ? `<@${report.handledBy}>` : '터미널';
    const handledAt = report.handledAt
      ? ` · ${toDiscordTime(report.handledAt)}`
      : '';

    return `${ACTION_LABELS[report.action]} · ${handler}${handledAt}`;
  }

  // '유효 경고 2회 · <시각> 까지 정지'. 경고는 6개월이 지나면 빠진다
  private toSanctionStateText(state: UserSanctionState | null) {
    if (!state) {
      return '-';
    }

    if (state.isWithdrawn) {
      return '탈퇴함';
    }

    const restriction = state.isPermanent
      ? '영구 정지 중'
      : state.isRestricted && state.restrictedUntil
        ? `${toDiscordTime(state.restrictedUntil)} 까지 정지`
        : '이용 제한 없음';

    return `유효 경고 ${state.warningCount}회 · ${restriction}`;
  }

  /*
   * 처리 전: [가리기 · 경고] (회원 신고는 [경고]) [영구 정지] [기각]. 처리 후: [되돌리기]
   * 신고당한 회원이 영구 정지 중이면 [탈퇴시키기] 를 더 단다
   */
  private buildButtons(
    report: ReportEntity,
    status: ReportStatus,
    state: UserSanctionState | null,
  ) {
    const reportId = Number(report.id);
    const buttons: { label: string; style: number; custom_id: string }[] =
      status === ReportStatus.PENDING
        ? [
            report.targetType === ReportTargetType.USER
              ? {
                  label: '경고',
                  style: BUTTON_STYLE.DANGER,
                  custom_id: toReportCustomId('warn', reportId),
                }
              : {
                  label: '가리기 · 경고',
                  style: BUTTON_STYLE.DANGER,
                  custom_id: toReportCustomId('blind', reportId),
                },
            {
              label: '영구 정지',
              style: BUTTON_STYLE.DANGER,
              custom_id: toReportCustomId('ban', reportId),
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

    if (state?.isPermanent && !state.isWithdrawn) {
      buttons.push({
        label: '탈퇴시키기',
        style: BUTTON_STYLE.DANGER,
        custom_id: toReportCustomId('withdraw', reportId),
      });
    }

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
