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
import { FollowService } from './follow.service';
import { GetFollowListQueryDto } from './dto/get-follow-list-query.dto';
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

  // 내가 팔로우하는 사람
  @Get('me/followings')
  async getMyFollowings(
    @CurrentUserId() currentUserId: number,
    @Query() query: GetFollowListQueryDto,
  ) {
    return await this.followService.getMyFollowings(currentUserId, query);
  }

  // 나를 팔로우하는 사람
  @Get('me/followers')
  async getMyFollowers(
    @CurrentUserId() currentUserId: number,
    @Query() query: GetFollowListQueryDto,
  ) {
    return await this.followService.getMyFollowers(currentUserId, query);
  }

  @Get('recommended-recipients')
  async getRecommendedRecipients(
    @CurrentUserId() currentUserId: number,
  ) {
    return await this.followService.getRecommendedRecipients(
      currentUserId,
    );
  }
}