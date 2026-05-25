import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordService } from './record.service';
import { RecordEntity } from './entities/record.entity';
import { RecordFileEntity } from './entities/record-file.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RecordEntity,
      RecordFileEntity,
    ]),
  ],
  providers: [RecordService],
  exports: [RecordService],
})
export class RecordModule {}