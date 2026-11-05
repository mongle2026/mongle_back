import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, KeyObject, verify } from 'crypto';
import {
  ReportHandleResult,
  ReportModerationService,
} from '../report-moderation.service';
import { RESTRICTION_DAYS, RestrictionPeriod } from '../enums/report.enum';
import { DiscordApiService } from './discord-api.service';
import { parseReportCustomId, toReportCustomId } from './report-custom-id';

// 디스코드가 보내는 요청 종류
const INTERACTION_TYPE = { PING: 1, MESSAGE_COMPONENT: 3 } as const;

// 디스코드에 돌려주는 응답 종류
const RESPONSE_TYPE = {
  PONG: 1,
  // 새 메시지로 답한다
  CHANNEL_MESSAGE: 4,
  // 일단 받았다고만 답하고, 처리는 뒤에서 한다 (버튼이 달린 메시지는 그대로)
  DEFERRED_UPDATE_MESSAGE: 6,
  // 버튼이 달린 메시지를 고쳐서 답한다
  UPDATE_MESSAGE: 7,
} as const;

// 누른 사람에게만 보이는 메시지
const EPHEMERAL_FLAG = 1 << 6;

const COMPONENT_TYPE = { ACTION_ROW: 1, BUTTON: 2 } as const;
const BUTTON_STYLE = { SECONDARY: 2, DANGER: 4 } as const;

// Ed25519 공개키(32바이트)를 Node crypto 가 읽는 SPKI(DER) 형식으로 감싸는 앞부분
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export type DiscordInteraction = {
  type: number;
  application_id: string;
  token: string;
  data?: { custom_id?: string };
  // 서버 채널에서 누르면 member.user, DM 에서 누르면 user
  member?: { user?: { id: string } };
  user?: { id: string };
};

const toEphemeralMessage = (content: string) => ({
  type: RESPONSE_TYPE.CHANNEL_MESSAGE,
  data: { content, flags: EPHEMERAL_FLAG, allowed_mentions: { parse: [] } },
});

const toDiscordTime = (date: Date) =>
  `<t:${Math.floor(new Date(date).getTime() / 1000)}:f>`;

const PERIOD_LABELS: Record<string, string> = {
  ...Object.fromEntries(RESTRICTION_DAYS.map((days) => [days, `${days}일`])),
  permanent: '영구',
};

/*
 * 디스코드 신고 메시지 버튼 처리 (Interactions Endpoint URL: POST /discord/interactions).
 * 디스코드는 3초 안에 응답을 받아야 해서, 받았다고 먼저 답하고 처리(DB · 알림 · 메시지 수정)는 뒤에서 한다.
 * DISCORD_MODERATOR_IDS 에 있는 디스코드 사용자만 처리할 수 있다.
 */
@Injectable()
export class DiscordInteractionService {
  private readonly logger = new Logger(DiscordInteractionService.name);
  private publicKey: KeyObject | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly discordApiService: DiscordApiService,
    private readonly reportModerationService: ReportModerationService,
  ) {}

  // 디스코드가 보낸 요청인지 서명으로 확인한다. 디스코드는 일부러 틀린 서명도 보내서 401 로 막는지 확인한다
  isValidSignature(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    timestamp: string | undefined,
  ) {
    const publicKey = this.getPublicKey();

    if (!publicKey || !rawBody || !signature || !timestamp) {
      return false;
    }

    try {
      return verify(
        null,
        Buffer.concat([Buffer.from(timestamp), rawBody]),
        publicKey,
        Buffer.from(signature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  handle(interaction: DiscordInteraction) {
    if (interaction.type === INTERACTION_TYPE.PING) {
      return { type: RESPONSE_TYPE.PONG };
    }

    if (interaction.type !== INTERACTION_TYPE.MESSAGE_COMPONENT) {
      return toEphemeralMessage('지원하지 않는 요청이에요.');
    }

    const userId = interaction.member?.user?.id ?? interaction.user?.id;

    if (!userId || !this.getModeratorIds().has(userId)) {
      return toEphemeralMessage('신고를 처리할 권한이 없어요.');
    }

    const button = parseReportCustomId(interaction.data?.custom_id ?? '');

    if (!button) {
      return toEphemeralMessage('알 수 없는 버튼이에요.');
    }

    const { action, reportId, period } = button;

    // 기간 없이 누르면 나만 보이는 기간 선택 버튼을 띄운다. 이게 확인 단계도 겸한다
    if (action === 'restrict' && !period) {
      return this.toPeriodPicker(reportId);
    }

    if (action === 'restrict' && period) {
      void this.runRestrict(interaction, reportId, period, userId);

      // 기간 선택 메시지를 '처리 중'으로 바꿔서 두 번 누르지 못하게 한다
      return {
        type: RESPONSE_TYPE.UPDATE_MESSAGE,
        data: { content: `신고 #${reportId} 처리 중이에요…`, components: [] },
      };
    }

    void this.runOnReportMessage(interaction, reportId, () =>
      action === 'blind'
        ? this.reportModerationService.blind(reportId, userId)
        : action === 'reject'
          ? this.reportModerationService.reject(reportId, userId)
          : this.reportModerationService.undo(reportId),
    );

    return { type: RESPONSE_TYPE.DEFERRED_UPDATE_MESSAGE };
  }

  private toPeriodPicker(reportId: number) {
    const periods: RestrictionPeriod[] = [...RESTRICTION_DAYS, 'permanent'];

    return {
      type: RESPONSE_TYPE.CHANNEL_MESSAGE,
      data: {
        content: `신고 #${reportId} 회원의 이용 제한 기간을 골라 주세요.`,
        flags: EPHEMERAL_FLAG,
        components: [
          {
            type: COMPONENT_TYPE.ACTION_ROW,
            components: periods.map((period) => ({
              type: COMPONENT_TYPE.BUTTON,
              style:
                period === 'permanent'
                  ? BUTTON_STYLE.DANGER
                  : BUTTON_STYLE.SECONDARY,
              label: PERIOD_LABELS[String(period)],
              custom_id: toReportCustomId('restrict', reportId, period),
            })),
          },
        ],
      },
    };
  }

  // 가리기 · 기각 · 되돌리기. 결과는 신고 메시지가 고쳐지는 것으로 보이고, 실패하거나 바뀐 게 없을 때만 따로 알린다
  private async runOnReportMessage(
    interaction: DiscordInteraction,
    reportId: number,
    run: () => Promise<ReportHandleResult>,
  ) {
    try {
      const result = await run();

      if (!result.isTargetChanged && result.reportCount === 0) {
        await this.sendFollowup(
          interaction,
          `신고 #${reportId} 는 이미 처리되어 바뀐 게 없어요.`,
        );
      }
    } catch (error) {
      await this.sendFollowup(interaction, this.toErrorMessage(error));
    }
  }

  private async runRestrict(
    interaction: DiscordInteraction,
    reportId: number,
    period: RestrictionPeriod,
    userId: string,
  ) {
    let content: string;

    try {
      const result = await this.reportModerationService.restrict(
        reportId,
        period,
        userId,
      );
      const until = result.restrictedUntil
        ? `${toDiscordTime(result.restrictedUntil)} 까지`
        : '영구';

      content = result.isTargetChanged
        ? `✅ 신고 #${reportId} 회원을 이용 제한했어요. (${until})`
        : `✅ 이미 제한 중인 회원이라 기간만 바꿨어요. (${until})`;
    } catch (error) {
      content = this.toErrorMessage(error);
    }

    try {
      await this.discordApiService.editInteractionResponse(
        interaction.application_id,
        interaction.token,
        { content, components: [], allowed_mentions: { parse: [] } },
      );
    } catch (error) {
      this.logError('이용 제한 결과 메시지 수정 실패', error);
    }
  }

  private async sendFollowup(interaction: DiscordInteraction, content: string) {
    try {
      await this.discordApiService.createFollowupMessage(
        interaction.application_id,
        interaction.token,
        { content, flags: EPHEMERAL_FLAG, allowed_mentions: { parse: [] } },
      );
    } catch (error) {
      this.logError('디스코드 추가 메시지 실패', error);
    }
  }

  // 처리 규칙에 맞지 않아 막힌 경우(이미 가려진 대상을 기각 등)는 그 이유를 그대로 보여준다
  private toErrorMessage(error: unknown) {
    if (error instanceof HttpException) {
      return `⚠️ ${error.message}`;
    }

    this.logError('디스코드 신고 처리 실패', error);

    return '⚠️ 처리하지 못했어요. 서버 로그를 확인해 주세요.';
  }

  private getModeratorIds() {
    return new Set(
      (this.configService.get<string>('DISCORD_MODERATOR_IDS') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );
  }

  private getPublicKey() {
    if (this.publicKey) {
      return this.publicKey;
    }

    const hex = this.configService.get<string>('DISCORD_PUBLIC_KEY');

    if (!hex) {
      return null;
    }

    try {
      this.publicKey = createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, 'hex')]),
        format: 'der',
        type: 'spki',
      });
    } catch (error) {
      this.logError('DISCORD_PUBLIC_KEY 형식이 올바르지 않습니다', error);
    }

    return this.publicKey;
  }

  private logError(message: string, error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.error(`${message}: ${detail}`);
  }
}
