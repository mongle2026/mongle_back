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
import { RestrictionAppealEntity } from './appeal/entities/restriction-appeal.entity';
import { AppealController } from './appeal/appeal.controller';
import { AppealService } from './appeal/appeal.service';
import { AppealDiscordService } from './appeal/appeal-discord.service';
import { UserSanctionEntity } from './sanction/entities/user-sanction.entity';
import { SanctionService } from './sanction/sanction.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReportEntity,
      RestrictionAppealEntity,
      UserSanctionEntity,
    ]),
    NotificationModule,
    // 영구 정지된 회원 탈퇴 (WithdrawalService)
    AuthModule,
  ],
  controllers: [
    ReportController,
    AppealController,
    DiscordInteractionController,
  ],
  providers: [
    ReportService,
    ReportModerationService,
    SanctionService,
    DiscordApiService,
    ReportDiscordService,
    DiscordInteractionService,
    AppealService,
    AppealDiscordService,
  ],
  exports: [ReportModerationService],
})
export class ReportModule {}
