import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { FollowService } from './follow.service';

@Controller('follow')
export class FollowController {
  constructor(private readonly followService: FollowService) {}

  @Post(':targetUserId')
  async followUser(
    @Param('targetUserId', ParseIntPipe) targetUserId: number,
    @Query('currentUserId') currentUserId: string,
  ) {
    const parsedCurrentUserId = this.parseRequiredNumber(
      currentUserId,
      'currentUserId',
    );

    return await this.followService.followUser(
      parsedCurrentUserId,
      targetUserId,
    );
  }

  @Delete(':targetUserId')
  async unfollowUser(
    @Param('targetUserId', ParseIntPipe) targetUserId: number,
    @Query('currentUserId') currentUserId: string,
  ) {
    const parsedCurrentUserId = this.parseRequiredNumber(
      currentUserId,
      'currentUserId',
    );

    return await this.followService.unfollowUser(
      parsedCurrentUserId,
      targetUserId,
    );
  }

  @Get(':targetUserId/status')
  async getFollowStatus(
    @Param('targetUserId', ParseIntPipe) targetUserId: number,
    @Query('currentUserId') currentUserId: string,
  ) {
    const parsedCurrentUserId = this.parseRequiredNumber(
      currentUserId,
      'currentUserId',
    );

    return await this.followService.getFollowStatus(
      parsedCurrentUserId,
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
    @Query('currentUserId') currentUserId: string,
  ) {
    const parsedCurrentUserId = this.parseRequiredNumber(
      currentUserId,
      'currentUserId',
    );

    return await this.followService.getRecommendedRecipients(
      parsedCurrentUserId,
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