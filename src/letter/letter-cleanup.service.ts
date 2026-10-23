import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LetterService } from './letter.service';

@Injectable()
export class LetterCleanupService {
  constructor(private readonly letterService: LetterService) {}

  /*
   * 첨부 파일은 정리 대기표로만 넘기고, R2 삭제는 4시 RecordFileCleanupService가 합니다.
   * 그 전에 돌도록 3시대에 둡니다.
   */
  @Cron('20 3 * * *')
  async handleDeletedLetterCleanup() {
    const batchSize = 100;

    for (;;) {
      const { targetCount } = await this.letterService.purgeDeletedLetters(
        30,
        batchSize,
      );

      if (targetCount < batchSize) {
        break;
      }
    }
  }
}
