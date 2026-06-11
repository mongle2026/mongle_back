import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordService } from './record.service';
import { RecordEntity } from './entities/record.entity';
import { RecordFileEntity } from './entities/record-file.entity';
import { RecordFileController } from './record-file.controller';
import { RecordFileService } from './record-file.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RecordEntity,
      RecordFileEntity,
    ]),
  ],
  controllers: [
    RecordFileController
  ],
  providers: [
    RecordService,
    RecordFileService,
  ],
  exports: [
    RecordService,
    RecordFileService,
  ],
})
export class RecordModule { }