import {
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { LetterService } from './letter.service';
import { CreateLetterDto } from './dto/create-letter.dto';
import 'multer';

@Controller('letter')
export class LetterController {
  constructor(private readonly letterService: LetterService) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async createLetter(
    @Body() dto: CreateLetterDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.letterService.createLetter(dto, files ?? []);
  }
}