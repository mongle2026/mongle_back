import {
  Controller,
  Get,
  Query,
  Param,
  Res,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { UserService } from './user.service';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) { }

  @Get('search')
  async searchUsers(
    @Query('keyword') keyword: string = '',
    @Query('currentUserId') currentUserId: string,
  ) {
    const parsedCurrentUserId = Number(currentUserId);

    if (!parsedCurrentUserId) {
      throw new BadRequestException('currentUserId가 필요합니다.');
    }

    return await this.userService.searchUsers(keyword, parsedCurrentUserId);
  }

  @Get(':id/profile-image')
  async getProfileImage(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const { imageData, imageMimeType } =
      await this.userService.getProfileImage(id);

    res.setHeader('Content-Type', imageMimeType);
    return res.send(imageData);
  }
}