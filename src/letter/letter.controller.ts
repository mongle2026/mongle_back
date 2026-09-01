import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { LetterService } from './letter.service';
import { CreateLetterDto } from './dto/create-letter.dto';

@Controller('letter')
export class LetterController {
  constructor(private readonly letterService: LetterService) { }

  @Post()
  async createLetter(
    @Body() dto: CreateLetterDto,
  ) {
    return this.letterService.createLetter(dto);
  }

  @Get(':letterId')
  async getLetterDetail(
    @Param('letterId', ParseIntPipe) letterId: number,
    @Query('userId', ParseIntPipe) userId: number,
  ) {
    return this.letterService.getLetterDetail({
      letterId,
      userId,
    });
  }
}