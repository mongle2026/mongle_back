import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { RecordFileService } from './record-file.service';

@Controller('record-file')
export class RecordFileController {
  constructor(private readonly recordFileService: RecordFileService) {}

  @Get(':id')
  async getFile(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const file = await this.recordFileService.getFileById(id);

    if (!file) {
      throw new NotFoundException('파일을 찾을 수 없습니다.');
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.fileSize);

    return res.send(file.fileData);
  }
}