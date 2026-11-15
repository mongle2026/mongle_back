import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const REQUEST_TIMEOUT = 5_000;
// 메시지를 지울 때 429(요청 너무 많음)를 받으면 기다렸다가 다시 보내는 최대 횟수
const DELETE_MAX_ATTEMPTS = 3;

export type DiscordMessageBody = Record<string, unknown>;

/*
 * 디스코드 REST API. 봇 토큰으로 신고 채널 · 이의 신청 채널에 메시지를 보내고 고친다.
 * 버튼을 누른 뒤의 응답 수정 · 추가 메시지는 interaction token 으로 보내서 봇 토큰이 필요 없다.
 * 에러 객체에는 토큰이 들어 있을 수 있어서, 부르는 쪽에서 메시지만 남긴다.
 */
@Injectable()
export class DiscordApiService {
  constructor(private readonly configService: ConfigService) {}

  // 봇 토큰과 신고 채널이 모두 있어야 봇으로 보낸다. 없으면 예전처럼 웹훅으로 보낸다
  isBotConfigured() {
    return !!(this.getBotToken() && this.getReportChannelId());
  }

  // 봇 토큰과 이의 신청 채널이 모두 있어야 이의 신청을 봇으로 보낸다
  isAppealBotConfigured() {
    return !!(this.getBotToken() && this.getAppealChannelId());
  }

  // 보낸 메시지 id 를 돌려준다
  async createReportMessage(body: DiscordMessageBody) {
    return await this.createMessage(this.getReportChannelId()!, body);
  }

  async editReportMessage(messageId: string, body: DiscordMessageBody) {
    await this.editMessage(this.getReportChannelId()!, messageId, body);
  }

  // 보낸 메시지 id 를 돌려준다
  async createAppealMessage(body: DiscordMessageBody) {
    return await this.createMessage(this.getAppealChannelId()!, body);
  }

  async editAppealMessage(messageId: string, body: DiscordMessageBody) {
    await this.editMessage(this.getAppealChannelId()!, messageId, body);
  }

  // 보관 기간이 지난 신고 메시지를 지운다
  async deleteReportMessage(messageId: string) {
    await this.deleteMessage(this.getReportChannelId()!, messageId);
  }

  async deleteAppealMessage(messageId: string) {
    await this.deleteMessage(this.getAppealChannelId()!, messageId);
  }

  // 버튼에 응답으로 보낸 메시지(나만 보이는 기간 선택 등)를 고친다
  async editInteractionResponse(
    applicationId: string,
    interactionToken: string,
    body: DiscordMessageBody,
  ) {
    await axios.patch(
      `${DISCORD_API_BASE_URL}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
      body,
      { timeout: REQUEST_TIMEOUT },
    );
  }

  // 버튼을 누른 사람에게 메시지를 하나 더 보낸다
  async createFollowupMessage(
    applicationId: string,
    interactionToken: string,
    body: DiscordMessageBody,
  ) {
    await axios.post(
      `${DISCORD_API_BASE_URL}/webhooks/${applicationId}/${interactionToken}`,
      body,
      { timeout: REQUEST_TIMEOUT },
    );
  }

  private async createMessage(channelId: string, body: DiscordMessageBody) {
    const { data } = await axios.post<{ id: string }>(
      `${DISCORD_API_BASE_URL}/channels/${channelId}/messages`,
      body,
      { headers: this.getBotHeaders(), timeout: REQUEST_TIMEOUT },
    );

    return data.id;
  }

  private async editMessage(
    channelId: string,
    messageId: string,
    body: DiscordMessageBody,
  ) {
    await axios.patch(
      `${DISCORD_API_BASE_URL}/channels/${channelId}/messages/${messageId}`,
      body,
      { headers: this.getBotHeaders(), timeout: REQUEST_TIMEOUT },
    );
  }

  /*
   * 이미 지워졌으면(404) 지운 것으로 본다.
   * 한꺼번에 많이 지우면 429 를 받으므로, 디스코드가 알려준 시간만큼 기다렸다가 다시 보낸다
   */
  private async deleteMessage(channelId: string, messageId: string) {
    for (let attempt = 1; ; attempt++) {
      try {
        await axios.delete(
          `${DISCORD_API_BASE_URL}/channels/${channelId}/messages/${messageId}`,
          { headers: this.getBotHeaders(), timeout: REQUEST_TIMEOUT },
        );
        return;
      } catch (error) {
        if (!axios.isAxiosError(error)) {
          throw error;
        }

        if (error.response?.status === 404) {
          return;
        }

        const retryAfterSeconds = Number(
          (error.response?.data as { retry_after?: number } | undefined)
            ?.retry_after,
        );

        if (
          error.response?.status !== 429 ||
          attempt >= DELETE_MAX_ATTEMPTS ||
          !Number.isFinite(retryAfterSeconds)
        ) {
          throw error;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, Math.ceil(retryAfterSeconds * 1000)),
        );
      }
    }
  }

  private getBotToken() {
    return this.configService.get<string>('DISCORD_BOT_TOKEN');
  }

  private getReportChannelId() {
    return this.configService.get<string>('DISCORD_REPORT_CHANNEL_ID');
  }

  private getAppealChannelId() {
    return this.configService.get<string>('DISCORD_APPEAL_CHANNEL_ID');
  }

  private getBotHeaders() {
    return { Authorization: `Bot ${this.getBotToken()}` };
  }
}
