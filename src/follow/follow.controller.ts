import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { FollowService } from './follow.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';

@Controller('follow')
@UseGuards(JwtAuthGuard)
export class FollowController {
  constructor(private readonly followService: FollowService) {}

  @Post(':targetUserId')
  async followUser(
    @Param('targetUserId', ParseUUIDPipe) targetUserId: string,
    @CurrentUserId() currentUserId: number,
  ) {
    return await this.followService.followUser(
      currentUserId,
      targetUserId,
    );
  }

  @Delete(':targetUserId')
  async unfollowUser(
    @Param('targetUserId', ParseUUIDPipe) targetUserId: string,
    @CurrentUserId() currentUserId: number,
  ) {
    return await this.followService.unfollowUser(
      currentUserId,
      targetUserId,
    );
  }

  @Get(':targetUserId/status')
  async getFollowStatus(
    @Param('targetUserId', ParseUUIDPipe) targetUserId: string,
    @CurrentUserId() currentUserId: number,
  ) {
    return await this.followService.getFollowStatus(
      currentUserId,
      targetUserId,
    );
  }

  // userId 는 그 사람의 publicId
  @Get('followings')
  async getFollowingUsers(@Query('userId') userId: string) {
    this.validatePublicId(userId, 'userId');
    return await this.followService.getFollowingUsersByPublicId(userId);
  }

  @Get('followers')
  async getFollowerUsers(@Query('userId') userId: string) {
    this.validatePublicId(userId, 'userId');
    return await this.followService.getFollowerUsersByPublicId(userId);
  }

  @Get('recommended-recipients')
  async getRecommendedRecipients(
    @CurrentUserId() currentUserId: number,
  ) {
    return await this.followService.getRecommendedRecipients(
      currentUserId,
    );
  }

  private validatePublicId(value: string | undefined, name: string) {
    if (!value || !isUUID(value)) {
      throw new BadRequestException(`${name}가 필요합니다.`);
    }
  }
}