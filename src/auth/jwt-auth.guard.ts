import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { getJwtSecret, verifyAuthToken } from './auth-token';

export type AuthenticatedRequest = Request & { userId: number };

// Authorization: Bearer <accessToken> 을 확인하고 req.userId 에 로그인한 사용자 id 를 넣는다.
// ConfigService 만 쓰므로 AuthModule 을 import 하지 않은 모듈에서도 @UseGuards(JwtAuthGuard) 로 바로 쓸 수 있다.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('로그인이 필요합니다.');
    }

    const payload = verifyAuthToken(
      token,
      'access',
      getJwtSecret(this.configService),
    );

    if (!payload) {
      throw new UnauthorizedException('인증이 만료되었거나 올바르지 않습니다.');
    }

    request.userId = Number(payload.sub);
    return true;
  }
}
