import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ReportEntity } from './entities/report.entity';
import { REPORT_REASON_LABELS } from './enums/report.enum';

const REQUEST_TIMEOUT = 5_000;
// 디스코드 embed 필드 값은 1024자까지 받는다
const FIELD_VALUE_MAX_LENGTH = 1024;
const EMBED_COLOR = 0xe5484d;

const truncate = (value: string, maxLength = FIELD_VALUE_MAX_LENGTH) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

@Injectable()
export class ReportDiscordService {
  private readonly logger = new Logger(ReportDiscordService.name);

  constructor(private readonly configService: ConfigService) {}

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

    // 코드 블록 안에서 ``` 가 나오면 블록이 끝나 버려서 막는다
    const snapshot = JSON.stringify(report.contentSnapshot, null, 2).replace(
      /```/g,
      '`​``',
    );

    try {
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
                  value: `${report.targetType} ${report.targetId}`,
                  inline: true,
                },
                {
                  name: '사유',
                  value: REPORT_REASON_LABELS[report.reason],
                  inline: true,
                },
                {
                  name: '신고한 회원 → 신고당한 회원 (user.id)',
                  value: `${report.reporterId} → ${report.reportedUserId}`,
                },
                { name: '상세', value: truncate(report.detail ?? '-') },
                {
                  name: '신고 당시 내용',
                  value: `\`\`\`json\n${truncate(snapshot, FIELD_VALUE_MAX_LENGTH - 12)}\n\`\`\``,
                },
              ],
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
}
