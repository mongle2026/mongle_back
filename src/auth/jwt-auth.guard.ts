import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { DataSource, IsNull } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { isRestrictedUser } from '../user/withdrawn-user';
import { RestrictionAppealEntity } from '../report/appeal/entities/restriction-appeal.entity';
import { getJwtSecret, verifyAuthToken } from './auth-token';

export type AuthenticatedRequest = Request & { userId: number };

const OPTIONAL_AUTH_KEY = 'optionalAuth';

// 로그인하지 않아도 부를 수 있는 API (JwtAuthGuard 와 같이 쓴다).
// 토큰이 없으면 req.userId 없이 통과하고, 토큰이 있으면 똑같이 확인해서 만료 · 무효면 401 을 준다
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH_KEY, true);

const ALLOW_RESTRICTED_KEY = 'allowRestricted';

// 이용 제한 중인 회원도 부를 수 있는 API (JwtAuthGuard 와 같이 쓴다). 이의 신청처럼 제재 화면에서 부르는 API 용
export const AllowRestricted = () => SetMetadata(ALLOW_RESTRICTED_KEY, true);

// 이용 제한된 회원이 API 를 부르면 403 과 함께 이 code 를 준다. 앱은 이걸 보고 제재 화면을 띄운다
export const ACCOUNT_RESTRICTED_ERROR_CODE = 'ACCOUNT_RESTRICTED';

/*
 * 탈퇴한 회원은 access token 이 아직 만료되지 않았어도 401 로 막는다.
 * 이용 제한 중인 회원은 403 으로 막는다 (allowRestricted 면 통과). 응답: { code, message, reason, restrictedAt, restrictedUntil, appealStatus }
 * (reason: ReportReason, restrictedAt: 제한이 시작된 시각, restrictedUntil: 끝나는 시각. 영구 제한이면 null,
 *  appealStatus: 이 제한에 낸 마지막 이의 신청의 AppealStatus. 안 냈으면 null)
 */
export async function assertActiveUser(
  dataSource: DataSource,
  userId: number,
  { allowRestricted = false }: { allowRestricted?: boolean } = {},
) {
  const user = await dataSource.getRepository(UserEntity).findOne({
    select: {
      id: true,
      restrictedAt: true,
      restrictedUntil: true,
      restrictedReason: true,
    },
    where: { id: userId, withdrawnAt: IsNull() },
  });

  if (!user) {
    throw new UnauthorizedException('탈퇴했거나 존재하지 않는 회원입니다.');
  }

  if (isRestrictedUser(user) && !allowRestricted) {
    const appeal = await dataSource
      .getRepository(RestrictionAppealEntity)
      .findOne({
        select: { id: true, status: true },
        where: { userId, restrictedAt: user.restrictedAt! },
        order: { id: 'DESC' },
      });

    throw new ForbiddenException({
      statusCode: 403,
      code: ACCOUNT_RESTRICTED_ERROR_CODE,
      message: '이용이 제한된 계정입니다.',
      reason: user.restrictedReason,
      restrictedAt: user.restrictedAt,
      restrictedUntil: user.restrictedUntil,
      appealStatus: appeal?.status ?? null,
    });
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
    const allowRestricted = this.reflector.getAllAndOverride<boolean>(
      ALLOW_RESTRICTED_KEY,
      [context.getHandler(), context.getClass()],
    );

    await assertActiveUser(this.dataSource, userId, { allowRestricted });

    request.userId = userId;
    return true;
  }
}
