import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUserId } from './current-user-id.decorator';
import { KakaoLoginDto } from './dto/kakao-login.dto';
import { AppleLoginDto } from './dto/apple-login.dto';
import { SignupDto } from './dto/signup.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  @Post('kakao')
  @HttpCode(HttpStatus.OK)
  async loginWithKakao(@Body() dto: KakaoLoginDto) {
    return this.authService.loginWithKakao(dto.accessToken);
  }

  @Post('apple')
  @HttpCode(HttpStatus.OK)
  async loginWithApple(@Body() dto: AppleLoginDto) {
    return this.authService.loginWithApple(dto.identityToken);
  }

  @Post('signup')
  async signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Get('user-code/availability')
  async checkUserCodeAvailable(@Query('userCode') userCode: string) {
    return this.authService.checkUserCodeAvailable(userCode);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUserId() userId: number) {
    return this.authService.logout(userId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUserId() userId: number) {
    return this.userService.getUserById(userId);
  }
}
