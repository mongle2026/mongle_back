import { Controller, Get, Query } from '@nestjs/common';
import { StampService } from './stamp.service';
import { GetStampCollectionQueryDto } from './dto/get-stamp-collection-query.dto';

@Controller('stamp')
export class StampController {
  constructor(private readonly stampService: StampService) {}

  @Get()
  async getStampCollection(@Query() query: GetStampCollectionQueryDto) {
    return this.stampService.getStampCollection({
      userId: query.userId,
    });
  }
}
