import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Param,
  ParseIntPipe,
  BadRequestException,
  DefaultValuePipe,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { ConfirmProfileImageDto } from './dto/confirm-profile-image.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) { }

  @Get('search')
  async searchUsers(
    @Query('keyword') keyword: string = '',
    @Query('currentUserId') currentUserId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe)
    page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe)
    limit: number,
  ) {
    const parsedCurrentUserId = Number(currentUserId);

    if (
      !Number.isInteger(parsedCurrentUserId) ||
      parsedCurrentUserId <= 0
    ) {
      throw new BadRequestException('currentUserId가 필요합니다.');
    }

    if (page < 1) {
      throw new BadRequestException('page는 1 이상이어야 합니다.');
    }

    if (limit < 1 || limit > 50) {
      throw new BadRequestException(
        'limit은 1 이상 50 이하여야 합니다.',
      );
    }

    return await this.userService.searchUsers(
      keyword,
      parsedCurrentUserId,
      page,
      limit,
    );
  }

  // 내 닉네임 / 아이디 수정
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(
    @CurrentUserId() userId: number,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.updateProfile(userId, dto);
  }

  @Get(':id')
  async getUser(
    @Param('id', ParseIntPipe) id: number,
  ) {
    if (id <= 0) {
      throw new BadRequestException(
        '사용자 id가 올바르지 않습니다.',
      );
    }

    return this.userService.getUserById(id);
  }

  @Post(':id/profile-image/upload-url')
  async createProfileImageUploadUrl(@Param('id', ParseIntPipe) id: number) {
    return this.userService.createProfileImageUploadUrl(id);
  }

  @Post(':id/profile-image/confirm')
  async confirmProfileImage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConfirmProfileImageDto,
  ) {
    return this.userService.confirmProfileImage(id, dto.mimeType);
  }

}