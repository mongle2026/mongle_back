import { Body, Controller, ForbiddenException, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RecordEntity } from './entities/record.entity';
import { RecordService } from './record.service';
import { R2Service } from '../storage/r2.service';
import { CreateUploadUrlsDto } from './dto/create-upload-urls.dto';
import { ConfirmRecordFilesDto } from './dto/confirm-record-files.dto';

@Controller('record')
export class RecordController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly recordService: RecordService,
    private readonly r2Service: R2Service,
  ) {}

  @Post(':recordId/upload-urls')
  async createUploadUrls(
    @Param('recordId', ParseIntPipe) recordId: number,
    @Body() dto: CreateUploadUrlsDto,
  ) {
    const record = await this.getOwnedRecord(recordId, Number(dto.userId));

    const uploads = await Promise.all(
      dto.files.map(async (file) => {
        const key = this.r2Service.buildRecordImageKey(
          record.userId,
          record.id,
          file.mimeType,
        );

        return {
          key,
          mimeType: file.mimeType,
          uploadUrl: await this.r2Service.createPresignedPutUrl(key, file.mimeType),
        };
      }),
    );

    return { uploads };
  }

  @Post(':recordId/files')
  async confirmFiles(
    @Param('recordId', ParseIntPipe) recordId: number,
    @Body() dto: ConfirmRecordFilesDto,
  ) {
    const record = await this.getOwnedRecord(recordId, Number(dto.userId));

    return this.recordService.attachFiles(this.dataSource.manager, record.id, dto.files);
  }

  private async getOwnedRecord(recordId: number, userId: number) {
    const record = await this.dataSource.manager.findOne(RecordEntity, {
      where: { id: recordId },
    });

    if (!record) {
      throw new NotFoundException('기록을 찾을 수 없습니다.');
    }

    if (Number(record.userId) !== userId) {
      throw new ForbiddenException('권한이 없습니다.');
    }

    return record;
  }
}
