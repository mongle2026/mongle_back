import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { ReportDiscordService } from './report-discord.service';
import { ReportEntity } from './entities/report.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ReportEntity])],
  controllers: [ReportController],
  providers: [ReportService, ReportDiscordService],
})
export class ReportModule {}
