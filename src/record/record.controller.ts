import { Body, Controller, Post } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RecordService } from './record.service';
import { CreateUploadUrlsDto } from './dto/create-upload-urls.dto';

@Controller('record')
export class RecordController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly recordService: RecordService,
  ) {}

  /*
   * 레코드를 만들기 전에 호출합니다.
   * 여기서 받은 key를 피드 · 편지 생성 요청의 files에 그대로 실어 보내면,
   * 레코드와 파일이 한 트랜잭션에서 함께 저장됩니다.
   */
  @Post('upload-urls')
  async createUploadUrls(@Body() dto: CreateUploadUrlsDto) {
    const uploads = await this.dataSource.transaction(async (manager) =>
      this.recordService.issueUploadUrls(manager, {
        userId: Number(dto.userId),
        files: dto.files,
      }),
    );

    return { uploads };
  }
}
