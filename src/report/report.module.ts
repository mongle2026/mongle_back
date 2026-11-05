import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { ReportModerationService } from './report-moderation.service';
import { ReportEntity } from './entities/report.entity';
import { NotificationModule } from '../notification/notification.module';
import { DiscordApiService } from './discord/discord-api.service';
import { ReportDiscordService } from './discord/report-discord.service';
import { DiscordInteractionController } from './discord/discord-interaction.controller';
import { DiscordInteractionService } from './discord/discord-interaction.service';

@Module({
  imports: [TypeOrmModule.forFeature([ReportEntity]), NotificationModule],
  controllers: [ReportController, DiscordInteractionController],
  providers: [
    ReportService,
    ReportModerationService,
    DiscordApiService,
    ReportDiscordService,
    DiscordInteractionService,
  ],
  exports: [ReportModerationService],
})
export class ReportModule {}
