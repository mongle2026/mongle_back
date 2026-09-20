import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RecordService } from './record.service';

@Injectable()
export class RecordFileCleanupService {
  constructor(private readonly recordService: RecordService) {}

  @Cron('0 4 * * *')
  async handlePendingFileCleanup() {
    await this.recordService.purgePendingFiles(100);
  }
}
