import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, KeyObject, verify } from 'crypto';
import {
  ReportHandleResult,
  ReportModerationService,
} from '../report-moderation.service';
import { DiscordApiService } from './discord-api.service';
import {
  ConfirmRequiredAction,
  isConfirmRequired,
  parseReportCustomId,
  toReportCustomId,
} from './report-custom-id';
import { ReportDiscordService } from './report-discord.service';
import { BUTTON_STYLE, COMPONENT_TYPE } from './discord-format.util';
import { parseAppealCustomId } from '../appeal/appeal-custom-id';
import { AppealService } from '../appeal/appeal.service';
import { AppealStatus } from '../appeal/entities/restriction-appeal.entity';

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

// 확인 버튼 문구
const CONFIRM_PROMPTS: Record<
  ConfirmRequiredAction,
  { content: (reportId: number) => string; label: string }
> = {
  ban: {
    content: (reportId) =>
      `신고 #${reportId} 의 신고당한 회원을 경고 횟수와 관계없이 **영구 정지**할까요? 글 신고면 글도 가려져요.`,
    label: '영구 정지',
  },
  withdraw: {
    content: (reportId) =>
      `신고 #${reportId} 의 신고당한 회원을 **탈퇴**시킬까요? 되돌릴 수 없고, 같은 소셜 계정으로 다시 가입할 수 없어요.`,
    label: '탈퇴시키기',
  },
};

/*
 * 디스코드 신고 · 이의 신청 메시지 버튼 처리 (Interactions Endpoint URL: POST /discord/interactions).
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
    private readonly reportDiscordService: ReportDiscordService,
    private readonly appealService: AppealService,
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

    const customId = interaction.data?.custom_id ?? '';
    const appealButton = parseAppealCustomId(customId);

    // 이의 신청 [제한 풀기] [기각]. 결과는 이의 신청 메시지가 고쳐지는 것으로 보인다
    if (appealButton) {
      void this.runAppeal(interaction, appealButton, userId);

      return { type: RESPONSE_TYPE.DEFERRED_UPDATE_MESSAGE };
    }

    const button = parseReportCustomId(customId);

    if (!button) {
      return toEphemeralMessage('알 수 없는 버튼이에요.');
    }

    const { action, reportId, isConfirmed } = button;

    // 예전 메시지의 이용 제한(기간 선택) 버튼. 신고 메시지를 지금 버튼으로 고친다
    if (action === 'restrict') {
      void this.reportDiscordService.syncByReportId(reportId);

      return toEphemeralMessage(
        '이용 제한은 이제 경고 누적 · 영구 정지로 처리해요. 신고 메시지를 새 버튼으로 고쳤어요.',
      );
    }

    // 영구 정지 · 탈퇴는 나만 보이는 확인 버튼을 한 번 더 누르게 한다
    if (isConfirmRequired(action) && !isConfirmed) {
      return this.toConfirmPrompt(action, reportId);
    }

    if (isConfirmRequired(action)) {
      void this.runConfirmed(interaction, action, reportId, userId);

      // 확인 메시지를 '처리 중'으로 바꿔서 두 번 누르지 못하게 한다
      return {
        type: RESPONSE_TYPE.UPDATE_MESSAGE,
        data: { content: `신고 #${reportId} 처리 중이에요…`, components: [] },
      };
    }

    void this.runOnReportMessage(interaction, reportId, () => {
      switch (action) {
        case 'blind':
          return this.reportModerationService.blind(reportId, userId);
        case 'warn':
          return this.reportModerationService.warn(reportId, userId);
        case 'reject':
          return this.reportModerationService.reject(reportId, userId);
        case 'undo':
          return this.reportModerationService.undo(reportId);
      }
    });

    return { type: RESPONSE_TYPE.DEFERRED_UPDATE_MESSAGE };
  }

  private toConfirmPrompt(action: ConfirmRequiredAction, reportId: number) {
    const prompt = CONFIRM_PROMPTS[action];

    return {
      type: RESPONSE_TYPE.CHANNEL_MESSAGE,
      data: {
        content: prompt.content(reportId),
        flags: EPHEMERAL_FLAG,
        components: [
          {
            type: COMPONENT_TYPE.ACTION_ROW,
            components: [
              {
                type: COMPONENT_TYPE.BUTTON,
                style: BUTTON_STYLE.DANGER,
                label: prompt.label,
                custom_id: toReportCustomId(action, reportId, true),
              },
            ],
          },
        ],
      },
    };
  }

  // 가리기 · 경고 · 기각 · 되돌리기. 결과(경고 수 · 정지)는 신고 메시지가 고쳐지는 것으로 보이고, 실패하거나 바뀐 게 없을 때만 따로 알린다
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

  // 영구 정지 · 탈퇴. 결과는 확인 메시지를 고쳐서 누른 사람에게 보여준다
  private async runConfirmed(
    interaction: DiscordInteraction,
    action: ConfirmRequiredAction,
    reportId: number,
    userId: string,
  ) {
    let content: string;

    try {
      if (action === 'ban') {
        const result = await this.reportModerationService.ban(reportId, userId);

        content = result.sanction
          ? `✅ 신고 #${reportId} 회원을 영구 정지했어요.`
          : `✅ 이미 영구 정지된 회원이라 남은 신고만 처리했어요.`;
      } else {
        await this.reportModerationService.withdraw(reportId, userId);

        content = `✅ 신고 #${reportId} 회원을 탈퇴시켰어요. 같은 소셜 계정으로 다시 가입할 수 없어요.`;
      }
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
      this.logError('처리 결과 메시지 수정 실패', error);
    }
  }

  // 이의 신청 처리. 이미 처리됐거나, 제한이 먼저 풀려서 닫았을 때만 따로 알린다
  private async runAppeal(
    interaction: DiscordInteraction,
    { action, appealId }: { action: 'accept' | 'reject'; appealId: number },
    userId: string,
  ) {
    try {
      const { status } =
        action === 'accept'
          ? await this.appealService.accept(appealId, userId)
          : await this.appealService.reject(appealId, userId);

      if (!status) {
        await this.sendFollowup(
          interaction,
          `이의 신청 #${appealId} 는 이미 처리되어 바뀐 게 없어요.`,
        );
      } else if (status === AppealStatus.CLOSED) {
        await this.sendFollowup(
          interaction,
          `이의 신청 #${appealId} 의 제한이 이미 풀렸거나 바뀌어서 처리하지 않고 닫았어요. 회원에게는 알리지 않았어요.`,
        );
      }
    } catch (error) {
      await this.sendFollowup(interaction, this.toErrorMessage(error));
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
