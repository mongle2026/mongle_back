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
import { DataSource } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import {
  isPermanentlyRestrictedUser,
  isRestrictedUser,
} from '../user/withdrawn-user';
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

// 영구 정지 상태에서 탈퇴된 회원(이의 신청 기간이 끝나 자동 탈퇴 · 운영자가 탈퇴시킴)이 API 를 부르거나
// 토큰을 새로 받으려 하면 401 과 함께 이 code 를 준다. 앱은 이걸 보고 로그아웃하면서 탈퇴 완료 화면을 띄운다
export const ACCOUNT_WITHDRAWN_ERROR_CODE = 'ACCOUNT_WITHDRAWN';

/*
 * 탈퇴한 회원에게 주는 401. 탈퇴해도 user.restricted_* 는 남아서(보관 기간 1년) 영구 정지 중에 탈퇴됐는지 알 수 있다.
 * 영구 정지 중에 탈퇴됐으면 ACCOUNT_WITHDRAWN code 를 붙이고, 아니면(정지 없이 스스로 탈퇴 등) code 없이 준다.
 * restricted_at 만 보지 않는 건 기간 정지가 끝난 뒤에도 restricted_at 이 남아 있기 때문이다
 */
export const createWithdrawnUserException = (
  user: Pick<UserEntity, 'restrictedAt' | 'restrictedUntil'>,
) =>
  isPermanentlyRestrictedUser(user)
    ? new UnauthorizedException({
        statusCode: 401,
        code: ACCOUNT_WITHDRAWN_ERROR_CODE,
        message: '운영정책에 따라 탈퇴 처리된 계정입니다.',
      })
    : new UnauthorizedException('탈퇴했거나 존재하지 않는 회원입니다.');

/*
 * 탈퇴한 회원은 access token 이 아직 만료되지 않았어도 401 로 막는다 (createWithdrawnUserException).
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
      withdrawnAt: true,
      restrictedAt: true,
      restrictedUntil: true,
      restrictedReason: true,
    },
    where: { id: userId },
  });

  if (!user) {
    throw new UnauthorizedException('탈퇴했거나 존재하지 않는 회원입니다.');
  }

  if (user.withdrawnAt) {
    throw createWithdrawnUserException(user);
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
