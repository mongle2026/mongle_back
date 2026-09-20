import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordService } from './record.service';
import { RecordFileCleanupService } from './record-file-cleanup.service';
import { RecordEntity } from './entities/record.entity';
import { RecordFileEntity } from './entities/record-file.entity';
import { RecordFilePendingEntity } from './entities/record-file-pending.entity';
import { RecordController } from './record.controller';
import { MusicModule } from '../music/music.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RecordEntity,
      RecordFileEntity,
      RecordFilePendingEntity,
    ]),
    MusicModule,
  ],
  controllers: [
    RecordController,
  ],
  providers: [
    RecordService,
    RecordFileCleanupService,
  ],
  exports: [
    RecordService,
  ],
})
export class RecordModule { }
