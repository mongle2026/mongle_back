import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

// Apple 권장 최대 유효기간은 6개월이지만, 여유를 두고 12시간마다 새로 발급한다.
const TOKEN_TTL_SECONDS = 60 * 60 * 12;
const REFRESH_MARGIN_SECONDS = 60;

@Injectable()
export class AppleMusicTokenService {
  private cachedToken: string | null = null;
  private cachedTokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) { }

  getDeveloperToken(): string {
    const now = Math.floor(Date.now() / 1000);

    if (this.cachedToken && this.cachedTokenExpiresAt - REFRESH_MARGIN_SECONDS > now) {
      return this.cachedToken;
    }

    const teamId = this.configService.get<string>('APPLE_TEAM_ID');
    const keyId = this.configService.get<string>('APPLE_MUSIC_KEY_ID');
    const privateKey = this.configService
      .get<string>('APPLE_MUSIC_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');

    if (!teamId || !keyId || !privateKey) {
      throw new InternalServerErrorException(
        'Apple Music API 인증 정보(APPLE_TEAM_ID, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_PRIVATE_KEY)가 설정되지 않았습니다.',
      );
    }

    const issuedAt = now;
    const expiresAt = issuedAt + TOKEN_TTL_SECONDS;

    this.cachedToken = jwt.sign(
      {
        iss: teamId,
        iat: issuedAt,
        exp: expiresAt,
      },
      privateKey,
      {
        algorithm: 'ES256',
        header: {
          alg: 'ES256',
          kid: keyId,
        },
      },
    );
    this.cachedTokenExpiresAt = expiresAt;

    return this.cachedToken;
  }
}
