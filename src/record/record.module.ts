import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordService } from './record.service';
import { RecordEntity } from './entities/record.entity';
import { RecordFileEntity } from './entities/record-file.entity';
import { RecordController } from './record.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RecordEntity,
      RecordFileEntity,
    ]),
  ],
  controllers: [
    RecordController,
  ],
  providers: [
    RecordService,
  ],
  exports: [
    RecordService,
  ],
})
export class RecordModule { }