import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BlockService } from './block.service';
import { GetBlockListQueryDto } from './dto/get-block-list-query.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';

@Controller('block')
@UseGuards(JwtAuthGuard)
export class BlockController {
  constructor(private readonly blockService: BlockService) {}

  // 내가 차단한 회원 목록
  @Get('me')
  async getMyBlockedUsers(
    @CurrentUserId() currentUserId: number,
    @Query() query: GetBlockListQueryDto,
  ) {
    return await this.blockService.getMyBlockedUsers(currentUserId, query);
  }

  @Post(':targetUserId')
  async blockUser(
    @Param('targetUserId', ParseUUIDPipe) targetUserId: string,
    @CurrentUserId() currentUserId: number,
  ) {
    return await this.blockService.blockUser(currentUserId, targetUserId);
  }

  @Delete(':targetUserId')
  async unblockUser(
    @Param('targetUserId', ParseUUIDPipe) targetUserId: string,
    @CurrentUserId() currentUserId: number,
  ) {
    return await this.blockService.unblockUser(currentUserId, targetUserId);
  }
}
