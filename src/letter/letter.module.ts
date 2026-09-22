import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LetterController } from './letter.controller';
import { LetterService } from './letter.service';
import { LetterEntity } from './entities/letter.entity';
import { RecordModule } from '../record/record.module';
import { NotificationModule } from '../notification/notification.module';
import { LetterNotificationScheduler } from './letter-notification.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([LetterEntity]),
    RecordModule,
    NotificationModule,
  ],
  controllers: [LetterController],
  providers: [LetterService, LetterNotificationScheduler],
  exports: [LetterService],
})
export class LetterModule {}