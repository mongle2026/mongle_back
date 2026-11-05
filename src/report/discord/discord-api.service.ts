import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const REQUEST_TIMEOUT = 5_000;

export type DiscordMessageBody = Record<string, unknown>;

/*
 * 디스코드 REST API. 봇 토큰으로 신고 채널에 메시지를 보내고 고친다.
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

  // 보낸 메시지 id 를 돌려준다
  async createReportMessage(body: DiscordMessageBody) {
    const { data } = await axios.post<{ id: string }>(
      `${DISCORD_API_BASE_URL}/channels/${this.getReportChannelId()}/messages`,
      body,
      { headers: this.getBotHeaders(), timeout: REQUEST_TIMEOUT },
    );

    return data.id;
  }

  async editReportMessage(messageId: string, body: DiscordMessageBody) {
    await axios.patch(
      `${DISCORD_API_BASE_URL}/channels/${this.getReportChannelId()}/messages/${messageId}`,
      body,
      { headers: this.getBotHeaders(), timeout: REQUEST_TIMEOUT },
    );
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

  private getBotToken() {
    return this.configService.get<string>('DISCORD_BOT_TOKEN');
  }

  private getReportChannelId() {
    return this.configService.get<string>('DISCORD_REPORT_CHANNEL_ID');
  }

  private getBotHeaders() {
    return { Authorization: `Bot ${this.getBotToken()}` };
  }
}
