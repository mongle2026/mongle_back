import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { AuthProvider } from '../user/enums/auth-provider.enum';

// 소셜 로그인 후 가입 화면을 채우는 동안 쓸 수 있는 시간
const SIGNUP_TOKEN_TTL = '1h';

export type AuthTokenType = 'access' | 'refresh';

export type AuthTokenPayload = {
  sub: string; // 우리 서비스 user.id
  typ: AuthTokenType;
};

export function getJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET');

  if (!secret) {
    throw new InternalServerErrorException(
      'JWT_SECRET 이 설정되지 않았습니다.',
    );
  }

  return secret;
}

// 서명/만료/종류가 모두 맞으면 payload, 아니면 null
export function verifyAuthToken(
  token: string,
  type: AuthTokenType,
  secret: string,
): AuthTokenPayload | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });

    if (
      typeof payload !== 'object' ||
      payload.typ !== type ||
      typeof payload.sub !== 'string'
    ) {
      return null;
    }

    return payload as AuthTokenPayload;
  } catch {
    return null;
  }
}

// 가입하지 않은 소셜 계정으로 로그인했을 때 발급한다. 가입 요청에서 어떤 소셜 계정인지 확인하는 데 쓴다.
export type SignupTokenPayload = {
  typ: 'signup';
  provider: AuthProvider;
  providerUserId: string;
};

export function signSignupToken(
  provider: AuthProvider,
  providerUserId: string,
  secret: string,
): string {
  const payload: SignupTokenPayload = {
    typ: 'signup',
    provider,
    providerUserId,
  };

  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: SIGNUP_TOKEN_TTL,
  });
}

// 서명/만료/종류가 모두 맞으면 payload, 아니면 null
export function verifySignupToken(
  token: string,
  secret: string,
): SignupTokenPayload | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });

    if (
      typeof payload !== 'object' ||
      payload.typ !== 'signup' ||
      !Object.values<string>(AuthProvider).includes(String(payload.provider)) ||
      typeof payload.providerUserId !== 'string'
    ) {
      return null;
    }

    return payload as SignupTokenPayload;
  } catch {
    return null;
  }
}
