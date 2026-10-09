import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { AuthProvider } from '../user/enums/auth-provider.enum';
import {
  normalizeUserCode,
  USER_CODE_PATTERN,
  USER_CODE_RULE_MESSAGE,
} from '../user/user-profile.validation';
import { isDuplicateEntryError } from '../database/mysql-error.util';
import { UserService } from '../user/user.service';
import { ProfileImageService } from '../user/profile-image.service';
import { KakaoApiService } from './kakao-api.service';
import { AppleApiService } from './apple-api.service';
import {
  getJwtSecret,
  signSignupToken,
  verifyAuthToken,
  verifySignupToken,
} from './auth-token';
import { SignupDto } from './dto/signup.dto';

const ACCESS_TOKEN_TTL = '1h';
const REFRESH_TOKEN_TTL = '30d';

const PROVIDER_LABELS: Record<AuthProvider, string> = {
  [AuthProvider.KAKAO]: '카카오',
  [AuthProvider.APPLE]: '애플',
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly userService: UserService,
    private readonly profileImageService: ProfileImageService,
    private readonly dataSource: DataSource,
    private readonly kakaoApiService: KakaoApiService,
    private readonly appleApiService: AppleApiService,
    private readonly configService: ConfigService,
  ) {}

  // 가입된 카카오 계정이면 토큰을 발급하고, 아니면 가입 화면으로 보내도록 isNewUser 와 signupToken 을 돌려준다.
  async loginWithKakao(kakaoAccessToken: string) {
    const kakaoUserId =
      await this.kakaoApiService.verifyAccessToken(kakaoAccessToken);

    return (
      (await this.loginIfRegistered(AuthProvider.KAKAO, kakaoUserId)) ??
      this.toNewUserResponse(
        AuthProvider.KAKAO,
        kakaoUserId,
        await this.kakaoApiService.getNickname(kakaoAccessToken),
      )
    );
  }

  // 애플은 이름을 최초 인증 때 앱에만 알려줘서 서버는 닉네임 기본값을 줄 수 없다.
  async loginWithApple(identityToken: string) {
    const appleUserId =
      await this.appleApiService.verifyIdentityToken(identityToken);

    return (
      (await this.loginIfRegistered(AuthProvider.APPLE, appleUserId)) ??
      this.toNewUserResponse(AuthProvider.APPLE, appleUserId, null)
    );
  }

  // TODO: 카카오/애플 로그인을 앱에 붙이면 지운다.
  // 소셜 로그인 없이 가입을 시험할 수 있게 임의의 카카오 계정으로 signupToken 을 발급한다.
  issueMockKakaoSignupToken() {
    return this.toNewUserResponse(
      AuthProvider.KAKAO,
      `mock-${randomUUID()}`,
      null,
    );
  }

  // 애플 identity token 은 10분이면 만료되므로, 가입 화면에 오래 머물러도 되도록
  // 소셜 토큰 대신 로그인 때 우리 서버가 발급한 signupToken 으로 소셜 계정을 확인한다.
  async signup(dto: SignupDto) {
    const account = verifySignupToken(
      dto.signupToken,
      getJwtSecret(this.configService),
    );

    if (!account) {
      throw new UnauthorizedException(
        '가입 가능 시간이 지났습니다. 다시 로그인해 주세요.',
      );
    }

    const { provider, providerUserId } = account;

    if (await this.userRepository.existsBy({ provider, providerUserId })) {
      throw new ConflictException(
        `이미 가입된 ${PROVIDER_LABELS[provider]} 계정입니다.`,
      );
    }

    if (await this.userRepository.existsBy({ userCode: dto.userCode })) {
      throw new ConflictException('이미 사용 중인 아이디입니다.');
    }

    const { profileImageKey } = dto;

    if (profileImageKey) {
      await this.profileImageService.verifyUploaded(profileImageKey);
    }

    let user: UserEntity;

    try {
      // 사진을 대기표에서 빼는 것과 회원 저장을 함께 처리한다. 저장이 실패하면 사진은 대기표로 돌아가 정리된다.
      user = await this.dataSource.transaction(async (manager) => {
        if (profileImageKey) {
          await this.profileImageService.attach(manager, profileImageKey);
        }

        return manager.save(
          manager.create(UserEntity, {
            provider,
            providerUserId,
            nickname: dto.nickname,
            userCode: dto.userCode,
            profileImageKey: profileImageKey ?? null,
          }),
        );
      });
    } catch (error) {
      // 위 확인과 저장 사이에 같은 소셜 계정/아이디로 동시에 가입한 경우
      if (isDuplicateEntryError(error)) {
        throw new ConflictException(
          '이미 가입된 계정이거나 사용 중인 아이디입니다.',
        );
      }

      throw error;
    }

    return {
      ...(await this.issueTokens(Number(user.id))),
      user: await this.userService.getUserById(Number(user.id)),
    };
  }

  // refresh token 은 한 번 쓰면 새로 발급하고(rotation), 이전 토큰은 더 이상 쓸 수 없다.
  async refresh(refreshToken: string) {
    const payload = verifyAuthToken(
      refreshToken,
      'refresh',
      getJwtSecret(this.configService),
    );

    if (!payload) {
      throw new UnauthorizedException('다시 로그인해 주세요.');
    }

    const user = await this.userRepository
      .createQueryBuilder('user')
      .select(['user.id'])
      .addSelect('user.refreshTokenHash')
      .where('user.id = :userId', { userId: payload.sub })
      .getOne();

    if (
      !user?.refreshTokenHash ||
      !this.isSameHash(user.refreshTokenHash, this.hashToken(refreshToken))
    ) {
      throw new UnauthorizedException('다시 로그인해 주세요.');
    }

    return this.issueTokens(Number(user.id));
  }

  async logout(userId: number) {
    await this.userRepository.update(
      { id: userId },
      { refreshTokenHash: null },
    );

    return { message: '로그아웃되었습니다.' };
  }

  async checkUserCodeAvailable(userCode: string) {
    const normalized = normalizeUserCode(userCode ?? '');

    if (!USER_CODE_PATTERN.test(normalized)) {
      throw new BadRequestException(USER_CODE_RULE_MESSAGE);
    }

    return {
      userCode: normalized,
      available: !(await this.userRepository.existsBy({
        userCode: normalized,
      })),
    };
  }

  // 가입된 소셜 계정이면 토큰을 발급하고, 아니면 null
  private async loginIfRegistered(
    provider: AuthProvider,
    providerUserId: string,
  ) {
    const user = await this.userRepository.findOne({
      where: { provider, providerUserId },
      select: { id: true },
    });

    if (!user) {
      return null;
    }

    return {
      isNewUser: false as const,
      ...(await this.issueTokens(Number(user.id))),
      user: await this.userService.getUserById(Number(user.id)),
    };
  }

  private toNewUserResponse(
    provider: AuthProvider,
    providerUserId: string,
    suggestedNickname: string | null,
  ) {
    return {
      isNewUser: true as const,
      signupToken: signSignupToken(
        provider,
        providerUserId,
        getJwtSecret(this.configService),
      ),
      // 가입 화면에서 닉네임 기본값으로 보여줄 값
      suggestedNickname,
    };
  }

  private async issueTokens(userId: number) {
    const secret = getJwtSecret(this.configService);
    const subject = String(userId);

    const accessToken = jwt.sign({ typ: 'access' }, secret, {
      algorithm: 'HS256',
      subject,
      expiresIn: ACCESS_TOKEN_TTL,
    });

    const refreshToken = jwt.sign({ typ: 'refresh' }, secret, {
      algorithm: 'HS256',
      subject,
      expiresIn: REFRESH_TOKEN_TTL,
      jwtid: randomUUID(),
    });

    // 원본 대신 해시만 저장. 새로 로그인하면 이전 기기의 refresh token 은 무효가 된다.
    await this.userRepository.update(
      { id: userId },
      { refreshTokenHash: this.hashToken(refreshToken) },
    );

    return { accessToken, refreshToken };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private isSameHash(a: string, b: string) {
    return (
      a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
    );
  }
}
