import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { AllowRestricted, JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUserId } from './current-user-id.decorator';
import { KakaoLoginDto } from './dto/kakao-login.dto';
import { AppleLoginDto } from './dto/apple-login.dto';
import { ReviewLoginDto } from './dto/review-login.dto';
import { SignupDto } from './dto/signup.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { WithdrawalService } from './withdrawal.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly withdrawalService: WithdrawalService,
  ) {}

  @Post('kakao')
  @HttpCode(HttpStatus.OK)
  async loginWithKakao(@Body() dto: KakaoLoginDto) {
    return this.authService.loginWithKakao(dto.accessToken);
  }

  @Post('apple')
  @HttpCode(HttpStatus.OK)
  async loginWithApple(@Body() dto: AppleLoginDto) {
    return this.authService.loginWithApple(
      dto.identityToken,
      dto.authorizationCode,
    );
  }

  // 앱 심사용 계정 로그인. 앱 로그인 화면의 숨겨진 입력창에서 부른다 (AuthService.loginForReview)
  // TODO(심사 로그인): 앱 심사에 쓸 피드 · 편지 같은 샘플 데이터를 심사 계정에 미리 넣어 두기
  @Post('review')
  @HttpCode(HttpStatus.OK)
  async loginForReview(@Body() dto: ReviewLoginDto) {
    return this.authService.loginForReview(dto.loginId, dto.password);
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

  // 회원 탈퇴. 처리 범위는 WithdrawalService 참고.
  // 이용 제한 중에도 탈퇴할 수 있다. 같은 소셜 계정으로 기간 정지는 끝날 때까지, 영구 정지는 1년 동안 다시 가입할 수 없다
  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @AllowRestricted()
  async withdraw(@CurrentUserId() userId: number, @Body() dto: WithdrawDto) {
    return this.withdrawalService.withdraw(userId, dto.authorizationCode);
  }
}
