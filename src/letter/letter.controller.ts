import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LetterService } from './letter.service';
import { CreateLetterDto } from './dto/create-letter.dto';
import { GetLetterboxQueryDto } from './dto/get-letterbox-query.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';

@Controller('letter')
@UseGuards(JwtAuthGuard)
export class LetterController {
  constructor(private readonly letterService: LetterService) { }

  @Post()
  async createLetter(
    @CurrentUserId() userId: number,
    @Body() dto: CreateLetterDto,
  ) {
    return this.letterService.createLetter(userId, dto);
  }

  @Get()
  async getLetterbox(
    @CurrentUserId() userId: number,
    @Query() query: GetLetterboxQueryDto,
  ) {
    return this.letterService.getLetterbox({
      userId,
      tab: query.tab,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get(':letterId')
  async getLetterDetail(
    @Param('letterId', ParseIntPipe) letterId: number,
    @CurrentUserId() userId: number,
  ) {
    return this.letterService.getLetterDetail({
      letterId,
      userId,
    });
  }

  @Delete(':letterId')
  async deleteLetter(
    @Param('letterId', ParseIntPipe) letterId: number,
    @CurrentUserId() userId: number,
  ) {
    return this.letterService.deleteLetter({
      letterId,
      userId,
    });
  }
}
