import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { In, Repository } from 'typeorm';
import { PushTokenEntity } from './entities/push-token.entity';

const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

// Expo 제한: 발송은 요청당 100건, 영수증 조회는 요청당 1000건
const SEND_CHUNK_SIZE = 100;
const RECEIPT_CHUNK_SIZE = 1000;

// Expo 는 발송 후 약 15분 뒤부터 영수증을 준다. 하루가 지나도 없으면 버린다.
const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const RECEIPT_EXPIRE_MS = 24 * 60 * 60 * 1000;

const REQUEST_TIMEOUT = 15_000;

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // 안드로이드 알림 채널. 앱에서 같은 id 로 채널을 만들어 둬야 한다.
  channelId?: string;
};

type ExpoPushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

type ExpoPushReceipt =
  | { status: 'ok' }
  | { status: 'error'; message: string; details?: { error?: string } };

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  // 영수증을 확인하기 전까지 들고 있는 ticket id → 토큰.
  // 메모리에만 두므로 재배포되면 사라지는데, 만료 토큰 정리가 조금 늦어지는 정도라 괜찮다.
  private readonly pendingTickets = new Map<
    string,
    { token: string; sentAt: number }
  >();

  constructor(
    @InjectRepository(PushTokenEntity)
    private readonly pushTokenRepository: Repository<PushTokenEntity>,

    private readonly configService: ConfigService,
  ) {}

  async send(messages: ExpoPushMessage[]) {
    const invalidTokens: string[] = [];

    for (let i = 0; i < messages.length; i += SEND_CHUNK_SIZE) {
      const chunk = messages.slice(i, i + SEND_CHUNK_SIZE);

      try {
        const { data } = await axios.post<{ data: ExpoPushTicket[] }>(
          EXPO_PUSH_SEND_URL,
          chunk.map((message) => ({
            sound: 'default',
            priority: 'high',
            ...message,
          })),
          { headers: this.getHeaders(), timeout: REQUEST_TIMEOUT },
        );

        const sentAt = Date.now();

        // ticket 은 보낸 메시지 순서와 같다
        data.data.forEach((ticket, index) => {
          const token = chunk[index].to;

          if (ticket.status === 'ok') {
            this.pendingTickets.set(ticket.id, { token, sentAt });
            return;
          }

          if (ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(token);
            return;
          }

          this.logger.warn(`푸시 발송 실패: ${ticket.message}`);
        });
      } catch (error) {
        this.logger.error('Expo 푸시 발송 요청 실패', error as Error);
      }
    }

    await this.removeTokens(invalidTokens);
  }

  // 앱을 지웠거나 토큰이 만료된 기기는 영수증에 DeviceNotRegistered 로 알려준다
  @Cron('0 */15 * * * *')
  async checkReceipts() {
    const now = Date.now();
    const readyIds: string[] = [];

    this.pendingTickets.forEach(({ sentAt }, id) => {
      if (now - sentAt > RECEIPT_EXPIRE_MS) {
        this.pendingTickets.delete(id);
        return;
      }

      if (now - sentAt >= RECEIPT_DELAY_MS) {
        readyIds.push(id);
      }
    });

    const invalidTokens: string[] = [];

    for (let i = 0; i < readyIds.length; i += RECEIPT_CHUNK_SIZE) {
      const ids = readyIds.slice(i, i + RECEIPT_CHUNK_SIZE);

      try {
        const { data } = await axios.post<{
          data: Record<string, ExpoPushReceipt>;
        }>(
          EXPO_PUSH_RECEIPTS_URL,
          { ids },
          { headers: this.getHeaders(), timeout: REQUEST_TIMEOUT },
        );

        Object.entries(data.data).forEach(([id, receipt]) => {
          const ticket = this.pendingTickets.get(id);
          this.pendingTickets.delete(id);

          if (
            ticket &&
            receipt.status === 'error' &&
            receipt.details?.error === 'DeviceNotRegistered'
          ) {
            invalidTokens.push(ticket.token);
          }
        });
      } catch (error) {
        this.logger.error('Expo 푸시 영수증 조회 실패', error as Error);
      }
    }

    await this.removeTokens(invalidTokens);
  }

  private async removeTokens(tokens: string[]) {
    if (tokens.length === 0) {
      return;
    }

    await this.pushTokenRepository.delete({ token: In([...new Set(tokens)]) });
  }

  private getHeaders() {
    // Expo 대시보드에서 Enhanced push security 를 켰다면 access token 이 필요하다
    const accessToken = this.configService.get<string>('EXPO_ACCESS_TOKEN');

    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
    };
  }
}
