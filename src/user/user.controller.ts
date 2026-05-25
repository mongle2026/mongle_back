import { Controller, Get, Query } from '@nestjs/common';
import { UserService } from './user.service';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('search')
  async searchUsers(@Query('keyword') keyword: string) {
    return this.userService.searchUsers(keyword);
  }
}