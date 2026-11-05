import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import axios from 'axios';
import {
  AppealStatus,
  RestrictionAppealEntity,
} from './entities/restriction-appeal.entity';
import { toAppealCustomId } from './appeal-custom-id';
import { ReportEntity } from '../entities/report.entity';
import {
  REPORT_REASON_LABELS,
  ReportAction,
  ReportTargetType,
} from '../enums/report.enum';
import {
  DiscordApiService,
  DiscordMessageBody,
} from '../discord/discord-api.service';
import {
  BUTTON_STYLE,
  COMPONENT_TYPE,
  escapeMarkdown,
  toDiscordTime,
  toQuote,
  truncate,
  withDbValue,
} from '../discord/discord-format.util';

const REQUEST_TIMEOUT = 5_000;

// 검토 전 주황(신고 빨강과 구분), 제한 풀기 초록, 기각 · 닫힘 회색
const STATUS_COLORS: Record<AppealStatus, number> = {
  [AppealStatus.PENDING]: 0xf76b15,
  [AppealStatus.ACCEPTED]: 0x30a46c,
  [AppealStatus.REJECTED]: 0x8b8d98,
  [AppealStatus.CLOSED]: 0x8b8d98,
};

const STATUS_LABELS: Record<AppealStatus, string> = {
  [AppealStatus.PENDING]: '검토 전',
  [AppealStatus.ACCEPTED]: '제한 풀기',
  [AppealStatus.REJECTED]: '기각 (제한 유지)',
  [AppealStatus.CLOSED]: '닫힘 (검토 전에 제한이 먼저 풀리거나 바뀜)',
};

/*
 * 이의 신청 디스코드 알림.
 * 봇 설정(DISCORD_BOT_TOKEN · DISCORD_APPEAL_CHANNEL_ID)이 있으면 이의 신청 채널에 [제한 풀기] [기각] 버튼을 단 메시지를 보내고,
 * 처리하면 그 메시지를 지금 상태로 고친다.
 * 봇 설정이 없으면 웹훅(DISCORD_APPEAL_WEBHOOK_URL)으로 버튼 없이 보낸다.
 * 실패해도 이의 신청 저장 · 처리에는 영향이 없도록 에러를 밖으로 던지지 않는다.
 */
@Injectable()
export class AppealDiscordService {
  private readonly logger = new Logger(AppealDiscordService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly discordApiService: DiscordApiService,
    private readonly dataSource: DataSource,

    @InjectRepository(RestrictionAppealEntity)
    private readonly appealRepository: Repository<RestrictionAppealEntity>,
  ) {}

  async notifyAppeal(appealId: number) {
    try {
      const body = await this.buildMessage(appealId);

      if (!body) {
        return;
      }

      if (this.discordApiService.isAppealBotConfigured()) {
        const messageId =
          await this.discordApiService.createAppealMessage(body);

        await this.appealRepository.update(
          { id: appealId },
          { discordMessageId: messageId },
        );
        return;
      }

      const webhookUrl = this.configService.get<string>(
        'DISCORD_APPEAL_WEBHOOK_URL',
      );

      if (!webhookUrl) {
        this.logger.warn(
          `디스코드 봇 설정(DISCORD_APPEAL_CHANNEL_ID)과 DISCORD_APPEAL_WEBHOOK_URL 이 모두 없어 이의 신청 #${appealId} 알림을 보내지 않았습니다.`,
        );
        return;
      }

      // 웹훅으로 보낸 메시지에는 누를 수 있는 버튼을 달 수 없다
      const { embeds, allowed_mentions } = body;

      await axios.post(
        webhookUrl,
        { embeds, allowed_mentions },
        { timeout: REQUEST_TIMEOUT },
      );
    } catch (error) {
      // 에러 객체에는 토큰 · 웹훅 주소가 들어 있어서 메시지만 남긴다
      this.logError(`이의 신청 #${appealId} 디스코드 알림 실패`, error);
    }
  }

  // 처리 결과를 메시지에 반영하고 버튼을 뗀다
  async syncMessage(appealId: number) {
    if (!this.discordApiService.isAppealBotConfigured()) {
      return;
    }

    try {
      const appeal = await this.appealRepository.findOne({
        select: { id: true, discordMessageId: true },
        where: { id: appealId },
      });
      const body = await this.buildMessage(appealId);

      if (!appeal?.discordMessageId || !body) {
        return;
      }

      await this.discordApiService.editAppealMessage(
        appeal.discordMessageId,
        body,
      );
    } catch (error) {
      this.logError(`이의 신청 #${appealId} 디스코드 메시지 수정 실패`, error);
    }
  }

  private async buildMessage(appealId: number) {
    const appeal = await this.appealRepository.findOne({
      relations: { user: true },
      where: { id: appealId },
    });

    if (!appeal) {
      return null;
    }

    const restrictReportId = await this.findRestrictReportId(appeal.userId);

    return {
      // 이의 신청 내용에 @everyone 같은 멘션이 있어도 아무도 호출되지 않게 막는다
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: `이의 신청 #${appeal.id}`,
          color: STATUS_COLORS[appeal.status],
          fields: [
            { name: '처리', value: this.toHandlingText(appeal) },
            {
              name: '회원 (user.id)',
              value: `${appeal.userId}`,
              inline: true,
            },
            {
              name: '닉네임',
              value: truncate(escapeMarkdown(appeal.user?.nickname || '-')),
              inline: true,
            },
            {
              name: '회원 코드 (user_code)',
              value: truncate(escapeMarkdown(appeal.user?.userCode || '-')),
              inline: true,
            },
            {
              name: '제한 사유',
              value: appeal.restrictedReason
                ? withDbValue(REPORT_REASON_LABELS, appeal.restrictedReason)
                : '-',
              inline: true,
            },
            {
              name: '제한 기간 (신청 당시)',
              value: appeal.restrictedUntil
                ? `${toDiscordTime(appeal.restrictedUntil)} 까지`
                : '영구',
              inline: true,
            },
            {
              name: '제한한 신고',
              value: restrictReportId ? `#${restrictReportId}` : '-',
              inline: true,
            },
            { name: '내용', value: toQuote(appeal.content) },
          ],
          timestamp: new Date(appeal.createdAt ?? Date.now()).toISOString(),
        },
      ],
      components: this.buildButtons(appeal),
    } satisfies DiscordMessageBody;
  }

  // '검토 전' 또는 '제한 풀기 · @운영자 · 시각'
  private toHandlingText(appeal: RestrictionAppealEntity) {
    const label = STATUS_LABELS[appeal.status];

    if (appeal.status === AppealStatus.PENDING) {
      return label;
    }

    // 임베드 안의 멘션은 알림이 가지 않는다
    const handler = appeal.handledBy ? ` · <@${appeal.handledBy}>` : '';
    const handledAt = appeal.handledAt
      ? ` · ${toDiscordTime(appeal.handledAt)}`
      : '';

    return `${label}${handler}${handledAt}`;
  }

  // 검토 전에만 [제한 풀기] [기각]. 처리하면 버튼을 뗀다
  private buildButtons(appeal: RestrictionAppealEntity) {
    if (appeal.status !== AppealStatus.PENDING) {
      return [];
    }

    const appealId = Number(appeal.id);

    return [
      {
        type: COMPONENT_TYPE.ACTION_ROW,
        components: [
          {
            type: COMPONENT_TYPE.BUTTON,
            label: '제한 풀기',
            style: BUTTON_STYLE.SUCCESS,
            custom_id: toAppealCustomId('accept', appealId),
          },
          {
            type: COMPONENT_TYPE.BUTTON,
            label: '기각',
            style: BUTTON_STYLE.SECONDARY,
            custom_id: toAppealCustomId('reject', appealId),
          },
        ],
      },
    ];
  }

  // 운영자가 바로 찾아볼 수 있게 이 회원을 제한한 신고 번호를 같이 보여준다
  private async findRestrictReportId(userId: number) {
    const report = await this.dataSource.getRepository(ReportEntity).findOne({
      select: { id: true },
      where: {
        targetType: ReportTargetType.USER,
        targetId: userId,
        action: ReportAction.RESTRICT,
      },
      order: { handledAt: 'DESC' },
    });

    return report ? Number(report.id) : null;
  }

  // 에러 객체에는 토큰 · 웹훅 주소가 들어 있어서 메시지만 남긴다
  private logError(message: string, error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.error(`${message}: ${detail}`);
  }
}
