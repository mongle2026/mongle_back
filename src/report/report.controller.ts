import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ReportService } from './report.service';
import { CreateReportDto } from './dto/create-report.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';

@Controller('report')
@UseGuards(JwtAuthGuard)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post('feed/:feedId')
  async reportFeed(
    @Param('feedId', ParseIntPipe) feedId: number,
    @CurrentUserId() currentUserId: number,
    @Body() dto: CreateReportDto,
  ) {
    return await this.reportService.reportFeed(currentUserId, feedId, dto);
  }

  @Post('comment/:commentId')
  async reportComment(
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUserId() currentUserId: number,
    @Body() dto: CreateReportDto,
  ) {
    return await this.reportService.reportComment(
      currentUserId,
      commentId,
      dto,
    );
  }

  @Post('letter/:letterId')
  async reportLetter(
    @Param('letterId', ParseIntPipe) letterId: number,
    @CurrentUserId() currentUserId: number,
    @Body() dto: CreateReportDto,
  ) {
    return await this.reportService.reportLetter(currentUserId, letterId, dto);
  }

  @Post('user/:targetUserId')
  async reportUser(
    @Param('targetUserId', ParseUUIDPipe) targetUserId: string,
    @CurrentUserId() currentUserId: number,
    @Body() dto: CreateReportDto,
  ) {
    return await this.reportService.reportUser(
      currentUserId,
      targetUserId,
      dto,
    );
  }
}
