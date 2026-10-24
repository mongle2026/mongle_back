import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createPublicKey, JsonWebKey, KeyObject } from 'crypto';
import * as jwt from 'jsonwebtoken';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

const REQUEST_TIMEOUT = 5_000;
// client_secret 은 최대 6개월까지 쓸 수 있지만, 탈퇴할 때만 쓰므로 그때그때 짧게 만든다
const CLIENT_SECRET_TTL_SECONDS = 5 * 60;
// 모르는 kid 의 토큰이 계속 와도 애플 공개키를 너무 자주 다시 받지 않도록
const KEYS_REFETCH_INTERVAL = 60_000;

const INVALID_TOKEN_MESSAGE = '애플 인증이 만료되었거나 올바르지 않습니다.';

type AppleKeysResponse = {
  keys: (JsonWebKey & { kid: string })[];
};

type AppleTokenResponse = {
  refresh_token?: string;
  id_token?: string;
};

@Injectable()
export class AppleApiService {
  private readonly logger = new Logger(AppleApiService.name);

  // 애플 공개키는 가끔만 바뀌어서 받아둔 것을 쓰고, 처음 보는 kid 가 오면 다시 받는다.
  private publicKeys = new Map<string, KeyObject>();
  private keysFetchedAt = 0;

  constructor(private readonly configService: ConfigService) {}

  // 앱에서 애플 로그인 후 받은 identity token(JWT)을 애플 공개키로 검증하고 애플 회원 식별값(sub)을 돌려준다.
  // 다른 앱용으로 발급된 토큰으로 로그인하는 것을 막기 위해 aud 가 우리 번들 ID 인지 꼭 확인한다.
  async verifyIdentityToken(identityToken: string): Promise<string> {
    const bundleId = this.configService.get<string>('APPLE_BUNDLE_ID');

    if (!bundleId) {
      throw new InternalServerErrorException(
        '애플 로그인 설정(APPLE_BUNDLE_ID)이 되어 있지 않습니다.',
      );
    }

    const kid = jwt.decode(identityToken, { complete: true })?.header.kid;
    const publicKey = kid ? await this.getPublicKey(kid) : null;

    if (!publicKey) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    let payload: string | jwt.JwtPayload;

    try {
      payload = jwt.verify(identityToken, publicKey, {
        algorithms: ['RS256'],
        issuer: APPLE_ISSUER,
        audience: bundleId,
      });
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    if (typeof payload !== 'object' || !payload.sub) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    return payload.sub;
  }

  /**
   * 탈퇴할 때 우리 앱과 애플 계정의 연결을 끊는다.
   * 앱이 탈퇴 직전에 애플 로그인을 한 번 더 해서 받은 authorizationCode 로 refresh token 을 받아 revoke 한다.
   * authorizationCode 는 발급 후 5분 안에 한 번만 쓸 수 있다.
   * 애플 로그인은 iOS 에서만 지원해서 client_id 는 번들 ID 다.
   */
  async revoke(authorizationCode: string, appleUserId: string): Promise<void> {
    const clientId = this.configService.get<string>('APPLE_BUNDLE_ID');

    if (!clientId) {
      throw new InternalServerErrorException(
        '애플 로그인 설정(APPLE_BUNDLE_ID)이 되어 있지 않습니다.',
      );
    }

    const clientSecret = this.createClientSecret(clientId);

    const { data } = await axios.post<AppleTokenResponse>(
      APPLE_TOKEN_URL,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: authorizationCode,
        grant_type: 'authorization_code',
      }),
      { timeout: REQUEST_TIMEOUT },
    );

    // 애플에서 직접 받은 토큰이라 서명 검증 없이 sub 만 본다.
    // 탈퇴하는 회원과 다른 애플 계정으로 받은 코드면 그 계정의 연결은 끊지 않는다.
    const idToken = data.id_token ? jwt.decode(data.id_token) : null;
    const sub = typeof idToken === 'object' ? idToken?.sub : undefined;

    if (sub !== appleUserId) {
      throw new Error('탈퇴하는 회원의 애플 계정으로 받은 코드가 아닙니다.');
    }

    if (!data.refresh_token) {
      throw new Error('애플 토큰 응답에 refresh_token 이 없습니다.');
    }

    await axios.post(
      APPLE_REVOKE_URL,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token: data.refresh_token,
        token_type_hint: 'refresh_token',
      }),
      { timeout: REQUEST_TIMEOUT },
    );
  }

  // 애플 토큰 API 에 우리 앱임을 증명하는 client_secret. Sign in with Apple 키(.p8)로 서명한다.
  private createClientSecret(clientId: string) {
    const teamId = this.configService.get<string>('APPLE_TEAM_ID');
    const keyId = this.configService.get<string>('APPLE_SIGNIN_KEY_ID');
    const privateKey = this.configService
      .get<string>('APPLE_SIGNIN_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');

    if (!teamId || !keyId || !privateKey) {
      throw new InternalServerErrorException(
        '애플 로그인 인증 정보(APPLE_TEAM_ID, APPLE_SIGNIN_KEY_ID, APPLE_SIGNIN_PRIVATE_KEY)가 설정되지 않았습니다.',
      );
    }

    return jwt.sign({}, privateKey, {
      algorithm: 'ES256',
      keyid: keyId,
      issuer: teamId,
      audience: APPLE_ISSUER,
      subject: clientId,
      expiresIn: CLIENT_SECRET_TTL_SECONDS,
    });
  }

  private async getPublicKey(kid: string): Promise<KeyObject | null> {
    if (
      !this.publicKeys.has(kid) &&
      Date.now() - this.keysFetchedAt >= KEYS_REFETCH_INTERVAL
    ) {
      await this.fetchPublicKeys();
    }

    return this.publicKeys.get(kid) ?? null;
  }

  private async fetchPublicKeys() {
    let keys: AppleKeysResponse['keys'];

    try {
      const { data } = await axios.get<AppleKeysResponse>(APPLE_KEYS_URL, {
        timeout: REQUEST_TIMEOUT,
      });
      keys = data.keys;
    } catch (error) {
      this.logger.error('애플 공개키 조회 실패', error);
      throw new InternalServerErrorException(
        '애플 서버와 통신하지 못했습니다.',
      );
    }

    this.publicKeys = new Map(
      keys.map((key) => [key.kid, createPublicKey({ key, format: 'jwk' })]),
    );
    this.keysFetchedAt = Date.now();
  }
}
