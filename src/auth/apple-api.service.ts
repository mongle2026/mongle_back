import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  hkdfSync,
  JsonWebKey,
  KeyObject,
  randomBytes,
} from 'crypto';
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
const INVALID_CODE_MESSAGE =
  '애플 인증이 만료되었거나 이미 사용되었습니다. 애플 로그인을 다시 해 주세요.';

// 저장해 두는 refresh token 의 암호화 키를 Sign in with Apple 키에서 만들 때 쓰는 용도 구분값
const TOKEN_KEY_INFO = 'mongle:social-unlink:apple-refresh-token';

type AppleKeysResponse = {
  keys: (JsonWebKey & { kid: string })[];
};

// identity token 에서 우리가 쓰는 값
export type AppleIdentity = {
  sub: string;
  // 앱이 이메일을 요청했을 때만 들어 있다. 사용자가 '나의 이메일 가리기'를 고르면 애플 중계 주소(@privaterelay.appleid.com)다.
  email: string | null;
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

  // 앱에서 애플 로그인 후 받은 identity token(JWT)을 애플 공개키로 검증하고 애플 회원 식별값(sub)과 이메일을 돌려준다.
  // 다른 앱용으로 발급된 토큰으로 로그인하는 것을 막기 위해 aud 가 우리 번들 ID 인지 꼭 확인한다.
  // 이메일은 앱이 따로 보내는 값 대신 서명을 확인한 토큰 안의 값을 쓴다.
  async verifyIdentityToken(identityToken: string): Promise<AppleIdentity> {
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

    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
    };
  }

  /**
   * 탈퇴 직전에 앱이 애플 로그인을 한 번 더 해서 받은 authorizationCode 를 refresh token 으로 바꾼다.
   * authorizationCode 는 발급 후 5분 안에 한 번만 쓸 수 있어서 나중에 다시 시도할 수 없다.
   * 그래서 탈퇴를 처리하기 전에 부르고, 실패하면 탈퇴하지 않는다.
   * refresh token 은 연결 끊기가 끝날 때까지 DB 에 두므로 암호화해서 돌려준다.
   */
  async exchangeCodeForRefreshToken(
    authorizationCode: string,
    appleUserId: string,
  ): Promise<string> {
    const clientId = this.getClientId();

    let data: AppleTokenResponse;

    try {
      ({ data } = await axios.post<AppleTokenResponse>(
        APPLE_TOKEN_URL,
        new URLSearchParams({
          client_id: clientId,
          client_secret: this.createClientSecret(clientId),
          code: authorizationCode,
          grant_type: 'authorization_code',
        }),
        { timeout: REQUEST_TIMEOUT },
      ));
    } catch (error) {
      // 코드가 만료됐거나 이미 쓴 코드면 invalid_grant. 앱이 애플 로그인을 다시 하면 된다.
      if (
        axios.isAxiosError<{ error?: string }>(error) &&
        error.response?.data?.error === 'invalid_grant'
      ) {
        throw new BadRequestException(INVALID_CODE_MESSAGE);
      }

      const response = axios.isAxiosError(error)
        ? ` response=${JSON.stringify(error.response?.data)}`
        : '';

      this.logger.error(`애플 코드 교환 실패${response}`, error as Error);
      throw new InternalServerErrorException(
        '애플 서버와 통신하지 못했습니다.',
      );
    }

    // 애플에서 직접 받은 토큰이라 서명 검증 없이 sub 만 본다.
    // 탈퇴하는 회원과 다른 애플 계정으로 받은 코드면 그 계정의 연결은 끊지 않는다.
    const idToken = data.id_token ? jwt.decode(data.id_token) : null;
    const sub = typeof idToken === 'object' ? idToken?.sub : undefined;

    if (sub !== appleUserId) {
      throw new BadRequestException(
        '탈퇴하는 회원의 애플 계정으로 받은 코드가 아닙니다.',
      );
    }

    if (!data.refresh_token) {
      this.logger.error('애플 토큰 응답에 refresh_token 이 없습니다.');
      throw new InternalServerErrorException(
        '애플 서버와 통신하지 못했습니다.',
      );
    }

    return this.encryptToken(data.refresh_token);
  }

  /**
   * 탈퇴할 때 우리 앱과 애플 계정의 연결을 끊는다.
   * exchangeCodeForRefreshToken 이 돌려준 암호화된 refresh token 을 받는다. 실패하면 같은 값으로 다시 부를 수 있다.
   * 이미 끊긴 토큰이어도 애플은 성공으로 응답한다.
   */
  async revokeRefreshToken(encryptedRefreshToken: string): Promise<void> {
    const clientId = this.getClientId();

    await axios.post(
      APPLE_REVOKE_URL,
      new URLSearchParams({
        client_id: clientId,
        client_secret: this.createClientSecret(clientId),
        token: this.decryptToken(encryptedRefreshToken),
        token_type_hint: 'refresh_token',
      }),
      { timeout: REQUEST_TIMEOUT },
    );
  }

  // 애플 로그인은 iOS 에서만 지원해서 client_id 는 번들 ID 다.
  private getClientId() {
    const clientId = this.configService.get<string>('APPLE_BUNDLE_ID');

    if (!clientId) {
      throw new InternalServerErrorException(
        '애플 로그인 설정(APPLE_BUNDLE_ID)이 되어 있지 않습니다.',
      );
    }

    return clientId;
  }

  // AES-256-GCM. 키는 따로 두지 않고 Sign in with Apple 키(.p8)에서 만든다.
  // 저장 형식: iv.authTag.암호문 (모두 base64url)
  private encryptToken(token: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getTokenKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);

    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString('base64url'))
      .join('.');
  }

  private decryptToken(encryptedToken: string) {
    const [iv, authTag, encrypted] = encryptedToken
      .split('.')
      .map((part) => Buffer.from(part, 'base64url'));

    const decipher = createDecipheriv('aes-256-gcm', this.getTokenKey(), iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }

  private getTokenKey() {
    const { privateKey } = this.getSigninKey();

    return Buffer.from(hkdfSync('sha256', privateKey, '', TOKEN_KEY_INFO, 32));
  }

  // 애플 토큰 API 에 우리 앱임을 증명하는 client_secret. Sign in with Apple 키(.p8)로 서명한다.
  private createClientSecret(clientId: string) {
    const { teamId, keyId, privateKey } = this.getSigninKey();

    return jwt.sign({}, privateKey, {
      algorithm: 'ES256',
      keyid: keyId,
      issuer: teamId,
      audience: APPLE_ISSUER,
      subject: clientId,
      expiresIn: CLIENT_SECRET_TTL_SECONDS,
    });
  }

  private getSigninKey() {
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

    return { teamId, keyId, privateKey };
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
