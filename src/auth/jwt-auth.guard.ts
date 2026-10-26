import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { DataSource, IsNull } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { getJwtSecret, verifyAuthToken } from './auth-token';

export type AuthenticatedRequest = Request & { userId: number };

const OPTIONAL_AUTH_KEY = 'optionalAuth';

// 로그인하지 않아도 부를 수 있는 API (JwtAuthGuard 와 같이 쓴다).
// 토큰이 없으면 req.userId 없이 통과하고, 토큰이 있으면 똑같이 확인해서 만료 · 무효면 401 을 준다
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH_KEY, true);

// 탈퇴한 회원은 access token 이 아직 만료되지 않았어도 막는다
export async function assertActiveUser(dataSource: DataSource, userId: number) {
  const isActive = await dataSource.getRepository(UserEntity).exists({
    where: { id: userId, withdrawnAt: IsNull() },
  });

  if (!isActive) {
    throw new UnauthorizedException('탈퇴했거나 존재하지 않는 회원입니다.');
  }
}

// Authorization: Bearer <accessToken> 을 확인하고 req.userId 에 로그인한 사용자 id 를 넣는다.
// ConfigService 와 DataSource 는 전역이라 AuthModule 을 import 하지 않은 모듈에서도 @UseGuards(JwtAuthGuard) 로 바로 쓸 수 있다.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      const isOptional = this.reflector.getAllAndOverride<boolean>(
        OPTIONAL_AUTH_KEY,
        [context.getHandler(), context.getClass()],
      );

      if (isOptional) {
        return true;
      }

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

    const userId = Number(payload.sub);
    await assertActiveUser(this.dataSource, userId);

    request.userId = userId;
    return true;
  }
}
