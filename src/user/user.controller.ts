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
import { ProfileImageService } from './profile-image.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { SignupOrJwtAuthGuard } from '../auth/signup-or-jwt-auth.guard';

@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly profileImageService: ProfileImageService,
  ) { }

  // 프로필 사진 업로드 URL. 가입 전에도 올릴 수 있도록 signupToken 으로도 부를 수 있다.
  // 올린 뒤 받은 key 를 가입 요청에 실어 보낸다.
  @Post('profile-image/upload-url')
  @UseGuards(SignupOrJwtAuthGuard)
  async createProfileImageUploadUrl() {
    return this.profileImageService.createUploadUrl();
  }

  @Get('search')
  @UseGuards(JwtAuthGuard)
  async searchUsers(
    @Query('keyword') keyword: string = '',
    @CurrentUserId() currentUserId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe)
    page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe)
    limit: number,
  ) {
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
      currentUserId,
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
  @UseGuards(JwtAuthGuard)
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

}