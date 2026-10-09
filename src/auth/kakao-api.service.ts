import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const KAKAO_TOKEN_INFO_URL = 'https://kapi.kakao.com/v1/user/access_token_info';
const KAKAO_USER_ME_URL = 'https://kapi.kakao.com/v2/user/me';

const REQUEST_TIMEOUT = 5_000;

type KakaoTokenInfoResponse = {
  id: number;
  expires_in: number;
  app_id: number;
};

type KakaoUserMeResponse = {
  id: number;
  kakao_account?: {
    profile?: {
      nickname?: string;
    };
  };
};

@Injectable()
export class KakaoApiService {
  private readonly logger = new Logger(KakaoApiService.name);

  constructor(private readonly configService: ConfigService) {}

  // 카카오 access token 이 유효하고, 우리 앱에서 발급된 토큰인지 확인한 뒤 카카오 회원번호를 문자열로 돌려준다.
  // 다른 앱에서 받은 토큰으로 로그인하는 것을 막기 위해 app_id 를 꼭 비교한다.
  async verifyAccessToken(accessToken: string): Promise<string> {
    const appId = this.configService.get<string>('KAKAO_APP_ID');

    if (!appId) {
      throw new InternalServerErrorException(
        '카카오 로그인 설정(KAKAO_APP_ID)이 되어 있지 않습니다.',
      );
    }

    let tokenInfo: KakaoTokenInfoResponse;

    try {
      const { data } = await axios.get<KakaoTokenInfoResponse>(
        KAKAO_TOKEN_INFO_URL,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: REQUEST_TIMEOUT,
        },
      );
      tokenInfo = data;
    } catch (error) {
      // 401: 만료되었거나 잘못된 토큰
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        throw new UnauthorizedException(
          '카카오 인증이 만료되었거나 올바르지 않습니다.',
        );
      }

      this.logger.error('카카오 토큰 확인 실패', error);
      throw new InternalServerErrorException(
        '카카오 서버와 통신하지 못했습니다.',
      );
    }

    if (String(tokenInfo.app_id) !== appId) {
      throw new UnauthorizedException(
        '이 앱에서 발급된 카카오 토큰이 아닙니다.',
      );
    }

    return String(tokenInfo.id);
  }

  // 가입 화면에서 닉네임 기본값으로 보여줄 카카오 닉네임. 동의하지 않았거나 실패하면 null.
  async getNickname(accessToken: string): Promise<string | null> {
    try {
      const { data } = await axios.get<KakaoUserMeResponse>(KAKAO_USER_ME_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: REQUEST_TIMEOUT,
      });

      return data.kakao_account?.profile?.nickname ?? null;
    } catch (error) {
      this.logger.warn(`카카오 프로필 조회 실패: ${String(error)}`);
      return null;
    }
  }
}
