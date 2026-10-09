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

const REQUEST_TIMEOUT = 5_000;
// 모르는 kid 의 토큰이 계속 와도 애플 공개키를 너무 자주 다시 받지 않도록
const KEYS_REFETCH_INTERVAL = 60_000;

const INVALID_TOKEN_MESSAGE = '애플 인증이 만료되었거나 올바르지 않습니다.';

type AppleKeysResponse = {
  keys: (JsonWebKey & { kid: string })[];
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
