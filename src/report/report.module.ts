import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { ReportDiscordService } from './report-discord.service';
import { ReportModerationService } from './report-moderation.service';
import { ReportEntity } from './entities/report.entity';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [TypeOrmModule.forFeature([ReportEntity]), NotificationModule],
  controllers: [ReportController],
  providers: [ReportService, ReportDiscordService, ReportModerationService],
  exports: [ReportModerationService],
})
export class ReportModule {}
