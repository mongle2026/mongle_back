import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FollowService } from './follow.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';

@Controller('follow')
@UseGuards(JwtAuthGuard)
export class FollowController {
  constructor(private readonly followService: FollowService) {}

  @Post(':targetUserId')
  async followUser(
    @Param('targetUserId', ParseIntPipe) targetUserId: number,
    @CurrentUserId() currentUserId: number,
  ) {
    return await this.followService.followUser(
      currentUserId,
      targetUserId,
    );
  }

  @Delete(':targetUserId')
  async unfollowUser(
    @Param('targetUserId', ParseIntPipe) targetUserId: number,
    @CurrentUserId() currentUserId: number,
  ) {
    return await this.followService.unfollowUser(
      currentUserId,
      targetUserId,
    );
  }

  @Get(':targetUserId/status')
  async getFollowStatus(
    @Param('targetUserId', ParseIntPipe) targetUserId: number,
    @CurrentUserId() currentUserId: number,
  ) {
    return await this.followService.getFollowStatus(
      currentUserId,
      targetUserId,
    );
  }

  @Get('followings')
  async getFollowingUsers(@Query('userId') userId: string) {
    const parsedUserId = this.parseRequiredNumber(userId, 'userId');
    return await this.followService.getFollowingUsers(parsedUserId);
  }

  @Get('followers')
  async getFollowerUsers(@Query('userId') userId: string) {
    const parsedUserId = this.parseRequiredNumber(userId, 'userId');
    return await this.followService.getFollowerUsers(parsedUserId);
  }

  @Get('recommended-recipients')
  async getRecommendedRecipients(
    @CurrentUserId() currentUserId: number,
  ) {
    return await this.followService.getRecommendedRecipients(
      currentUserId,
    );
  }

  private parseRequiredNumber(value: string | undefined, name: string) {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`${name}가 필요합니다.`);
    }

    return parsed;
  }
}