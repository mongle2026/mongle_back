import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LetterService } from './letter.service';

const BATCH_SIZE = 100;
// 한 번 실행에서 처리할 최대 묶음 수. 남은 편지는 다음 실행(다음 날)에 이어서 처리한다.
const MAX_BATCHES_PER_RUN = 50;

@Injectable()
export class LetterCleanupService {
  constructor(private readonly letterService: LetterService) {}

  /*
   * 첨부 파일은 정리 대기표로만 넘기고, R2 삭제는 RecordFileCleanupService(03:40)가 합니다.
   * 그 전에 돌도록 03:20에 둡니다.
   */
  @Cron('20 3 * * *', { timeZone: 'Asia/Seoul' })
  async handleDeletedLetterCleanup() {
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const { targetCount } = await this.letterService.purgeDeletedLetters(
        30,
        BATCH_SIZE,
      );

      if (targetCount < BATCH_SIZE) {
        break;
      }
    }
  }
}
