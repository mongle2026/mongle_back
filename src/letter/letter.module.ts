import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LetterController } from './letter.controller';
import { LetterService } from './letter.service';
import { LetterEntity } from './entities/letter.entity';
import { RecordModule } from '../record/record.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LetterEntity]),
    RecordModule,
  ],
  controllers: [LetterController],
  providers: [LetterService],
})
export class LetterModule {}