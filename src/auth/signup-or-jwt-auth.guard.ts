import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  getJwtSecret,
  verifyAuthToken,
  verifySignupToken,
} from './auth-token';
import { assertActiveUser, AuthenticatedRequest } from './jwt-auth.guard';

// 가입 전(signupToken)과 로그인 후(accessToken) 모두 부를 수 있는 API 용.
// Authorization: Bearer <signupToken | accessToken>. accessToken 이면 req.userId 도 넣는다.
@Injectable()
export class SignupOrJwtAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('로그인이 필요합니다.');
    }

    const secret = getJwtSecret(this.configService);
    const payload = verifyAuthToken(token, 'access', secret);

    if (payload) {
      const userId = Number(payload.sub);
      await assertActiveUser(this.dataSource, userId);

      request.userId = userId;
      return true;
    }

    if (verifySignupToken(token, secret)) {
      return true;
    }

    throw new UnauthorizedException('인증이 만료되었거나 올바르지 않습니다.');
  }
}
