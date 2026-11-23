import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { AuthProvider } from '../user/enums/auth-provider.enum';
import { NotificationSettingEntity } from '../notification/entities/notification-setting.entity';
import { NotificationSettingKey } from '../notification/enums/notification.enum';
import {
  normalizeUserCode,
  USER_CODE_PATTERN,
  USER_CODE_RULE_MESSAGE,
} from '../user/user-profile.validation';
import { isDuplicateEntryError } from '../database/db-error.util';
import { UserService } from '../user/user.service';
import { ProfileImageService } from '../user/profile-image.service';
import { pickDefaultProfileImageNo } from '../user/default-profile-image';
import { KakaoApiService } from './kakao-api.service';
import { AppleApiService } from './apple-api.service';
import {
  getJwtSecret,
  signSignupToken,
  verifyAuthToken,
  verifySignupToken,
} from './auth-token';
import { SignupDto } from './dto/signup.dto';
import { BannedAccountEntity } from './entities/banned-account.entity';
import { createWithdrawnUserException } from './jwt-auth.guard';

// 이용 제한 중에 탈퇴한 소셜 계정이 재가입 제한 기간에 로그인 · 가입하면 403 과 함께 주는 code
export const ACCOUNT_BANNED_ERROR_CODE = 'ACCOUNT_BANNED';

// 예: 2027년 11월 15일 오후 3:00
const formatKstDate = (date: Date) =>
  new Date(date).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'long',
    timeStyle: 'short',
  });

const ACCESS_TOKEN_TTL = '1h';
const REFRESH_TOKEN_TTL = '30d';

const PROVIDER_LABELS: Record<AuthProvider, string> = {
  [AuthProvider.KAKAO]: '카카오',
  [AuthProvider.APPLE]: '애플',
  [AuthProvider.REVIEW]: '심사용',
};

// 앱 심사용 계정은 하나만 둔다. provider_user_id 로 이 값을 쓴다
const REVIEW_PROVIDER_USER_ID = 'review';
const REVIEW_NICKNAME = '몽글 심사';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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
      (await this.assertNotBanned(AuthProvider.KAKAO, kakaoUserId)) ??
      this.toNewUserResponse(
        AuthProvider.KAKAO,
        kakaoUserId,
        await this.kakaoApiService.getNickname(kakaoAccessToken),
        null,
        null,
      )
    );
  }

  // 애플은 이름을 최초 인증 때 앱에만 알려줘서 서버는 닉네임 기본값을 줄 수 없다.
  // 이메일은 identity token 에 들어 있어서 가입할 때 저장하도록 signupToken 에 담는다.
  // authorizationCode 는 애플 refresh token 으로 바꿔 user.apple_refresh_token 에 둔다.
  // 운영자가 영구 정지된 회원을 탈퇴시킬 때처럼 회원의 애플 인증 없이도 애플 연결을 끊기 위해서다.
  // 아직 가입 전이면 가입 화면에 머무는 동안 코드가 만료되므로(5분) 지금 바꿔서 signupToken 에 담는다.
  async loginWithApple(identityToken: string, authorizationCode?: string) {
    const { sub: appleUserId, email } =
      await this.appleApiService.verifyIdentityToken(identityToken);

    const userId = await this.findUserId(AuthProvider.APPLE, appleUserId);

    if (userId) {
      const [response] = await Promise.all([
        this.toLoginResponse(userId),
        this.saveAppleRefreshToken(userId, appleUserId, authorizationCode),
      ]);

      return response;
    }

    await this.assertNotBanned(AuthProvider.APPLE, appleUserId);

    return this.toNewUserResponse(
      AuthProvider.APPLE,
      appleUserId,
      null,
      email,
      await this.exchangeAppleCode(appleUserId, authorizationCode),
    );
  }

  /*
   * 앱 심사용 계정 로그인. 심사자는 카카오 · 애플 계정 없이 env 의 아이디/비밀번호로 로그인한다.
   * env 가 비어 있으면 이 로그인을 막는다(404). 심사가 끝나면 env 를 지워서 끈다.
   * 심사자가 탈퇴를 시험하면 provider_user_id 가 비워져 계정을 못 찾으므로, 그때는 새 심사 계정을 만든다.
   * 응답은 가입된 소셜 계정 로그인과 같다
   */
  // TODO(심사 로그인): 배포 서버 env 에 REVIEW_LOGIN_ID / REVIEW_LOGIN_PASSWORD 넣기. 비밀번호는 길고 임의로 (무차별 대입 제한이 없다)
  // TODO(심사 로그인): 심사가 끝나면 env 를 지워서 이 로그인을 끄기. 다음 심사 때 다시 넣는다
  // TODO(심사 로그인): 요청 횟수 제한(@nestjs/throttler 등)이 생기면 이 API 에 걸기
  async loginForReview(loginId: string, password: string) {
    const expectedId = this.configService.get<string>('REVIEW_LOGIN_ID');
    const expectedPassword = this.configService.get<string>(
      'REVIEW_LOGIN_PASSWORD',
    );

    if (!expectedId || !expectedPassword) {
      throw new NotFoundException();
    }

    // 둘 다 비교해서 아이디만 맞았는지 응답 시간으로 알 수 없게 한다
    const isIdMatched = this.isSameText(loginId, expectedId);
    const isPasswordMatched = this.isSameText(password, expectedPassword);

    if (!isIdMatched || !isPasswordMatched) {
      this.logger.warn('심사용 계정 로그인 실패');

      throw new UnauthorizedException('아이디 또는 비밀번호가 맞지 않습니다.');
    }

    const userId =
      (await this.findUserId(AuthProvider.REVIEW, REVIEW_PROVIDER_USER_ID)) ??
      (await this.createReviewUser());

    return this.toLoginResponse(userId);
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

    const { provider, providerUserId, email, appleRefreshToken } = account;

    // 로그인 때 막지만, 그 뒤에 탈퇴된 계정이 가입 화면에 머물러 있을 수 있다
    await this.assertNotBanned(provider, providerUserId);

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
      // 사진을 대기표에서 빼는 것, 회원 저장, 광고성 정보 수신 동의 저장을 함께 처리한다.
      // 저장이 실패하면 사진은 대기표로 돌아가 정리된다.
      user = await this.dataSource.transaction(async (manager) => {
        if (profileImageKey) {
          await this.profileImageService.attach(manager, profileImageKey);
        }

        const savedUser = await manager.save(
          manager.create(UserEntity, {
            publicId: randomUUID(),
            provider,
            providerUserId,
            email,
            appleRefreshToken:
              provider === AuthProvider.APPLE ? appleRefreshToken : null,
            nickname: dto.nickname,
            userCode: dto.userCode,
            profileImageKey: profileImageKey ?? null,
            defaultProfileImageNo:
              dto.defaultProfileImageNo ?? pickDefaultProfileImageNo(),
          }),
        );

        // 동의 여부를 이벤트 알림 설정으로 남긴다. 비동의도 행을 남겨 가입 때 고른 시각(updated_at)을 보관한다.
        await manager.save(
          manager.create(NotificationSettingEntity, {
            userId: Number(savedUser.id),
            settingKey: NotificationSettingKey.EVENT,
            enabled: dto.isMarketingAgreed ?? false,
          }),
        );

        return savedUser;
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
      .select([
        'user.id',
        'user.withdrawnAt',
        'user.restrictedAt',
        'user.restrictedUntil',
      ])
      .addSelect('user.refreshTokenHash')
      .where('user.id = :userId', { userId: payload.sub })
      .getOne();

    // 탈퇴하면 refresh token 해시가 지워져서 아래에서도 막히지만, 영구 정지로 탈퇴됐으면 앱이 알 수 있게 code 를 붙인다.
    // 앱을 오래 꺼 두면 access token 이 만료돼 가드보다 여기를 먼저 거친다
    if (user?.withdrawnAt) {
      throw createWithdrawnUserException(user);
    }

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
    const userId = await this.findUserId(provider, providerUserId);

    return userId ? this.toLoginResponse(userId) : null;
  }

  // 가입된 소셜 계정이면 회원 id, 아니면 null (탈퇴한 회원은 provider_user_id 를 비워서 찾지 않는다)
  private async findUserId(provider: AuthProvider, providerUserId: string) {
    const user = await this.userRepository.findOne({
      where: { provider, providerUserId },
      select: { id: true },
    });

    return user ? Number(user.id) : null;
  }

  private async toLoginResponse(userId: number) {
    return {
      isNewUser: false as const,
      ...(await this.issueTokens(userId)),
      user: await this.userService.getUserById(userId),
    };
  }

  // 로그인할 때마다 새로 받은 애플 refresh token 으로 바꾼다. 못 받았으면 저장된 값을 그대로 둔다
  private async saveAppleRefreshToken(
    userId: number,
    appleUserId: string,
    authorizationCode?: string,
  ) {
    const appleRefreshToken = await this.exchangeAppleCode(
      appleUserId,
      authorizationCode,
    );

    if (appleRefreshToken) {
      await this.userRepository.update({ id: userId }, { appleRefreshToken });
    }
  }

  /*
   * 애플 authorizationCode 를 암호화된 refresh token 으로 바꾼다. 코드가 없거나 실패하면 null.
   * 애플 서버 문제로 로그인까지 막히지 않도록 실패해도 로그만 남긴다.
   * 이 경우 본인 탈퇴는 그때 받는 authorizationCode 로 끊고, 운영자가 탈퇴시킬 때는 애플 연결을 끊지 못한다
   */
  private async exchangeAppleCode(
    appleUserId: string,
    authorizationCode?: string,
  ): Promise<string | null> {
    if (!authorizationCode) {
      return null;
    }

    try {
      return await this.appleApiService.exchangeCodeForRefreshToken(
        authorizationCode,
        appleUserId,
      );
    } catch (error) {
      this.logger.warn(
        `애플 로그인 코드 교환 실패. 애플 refresh token 없이 진행 (${String(error)})`,
      );

      return null;
    }
  }

  /*
   * 이용 제한 중에 탈퇴한 소셜 계정이면 재가입 제한이 끝날 때까지 403 으로 막는다. 앱은 rejoinAvailableAt 으로 재가입 차단 화면을 띄운다.
   * 로그인에서 ?? 로 이어 쓰려고 막히지 않으면 null 을 돌려준다
   */
  private async assertNotBanned(
    provider: AuthProvider,
    providerUserId: string,
  ): Promise<null> {
    const banned = await this.dataSource
      .getRepository(BannedAccountEntity)
      .findOne({
        select: { id: true, expiresAt: true },
        where: { provider, providerUserId },
      });

    // expires_at 이 비어 있으면 마이그레이션 전 행이라 막는다
    if (banned && (!banned.expiresAt || banned.expiresAt > new Date())) {
      throw new ForbiddenException({
        statusCode: 403,
        code: ACCOUNT_BANNED_ERROR_CODE,
        // 다시 가입할 수 있게 되는 시각. 앱의 재가입 차단 화면에 보여준다 (마이그레이션 전 행이면 null)
        rejoinAvailableAt: banned.expiresAt,
        message: banned.expiresAt
          ? `운영정책 위반으로 이용이 제한된 계정이라 ${formatKstDate(banned.expiresAt)}까지 다시 가입할 수 없어요.`
          : '운영정책 위반으로 이용이 제한된 계정이라 다시 가입할 수 없어요.',
      });
    }

    return null;
  }

  // 심사용 계정을 만든다. 아이디 규칙(user-profile.validation.ts)이 12자까지라 뒤에 임의 글자를 붙인다
  private async createReviewUser(): Promise<number> {
    try {
      const user = await this.dataSource.transaction(async (manager) => {
        const savedUser = await manager.save(
          manager.create(UserEntity, {
            publicId: randomUUID(),
            provider: AuthProvider.REVIEW,
            providerUserId: REVIEW_PROVIDER_USER_ID,
            email: null,
            appleRefreshToken: null,
            nickname: REVIEW_NICKNAME,
            userCode: `review_${randomUUID().slice(0, 5)}`,
            profileImageKey: null,
            defaultProfileImageNo: pickDefaultProfileImageNo(),
          }),
        );

        // 가입과 같이 이벤트 알림 설정 행을 남긴다. 심사 계정은 광고성 정보 수신에 동의하지 않은 것으로 둔다
        await manager.save(
          manager.create(NotificationSettingEntity, {
            userId: Number(savedUser.id),
            settingKey: NotificationSettingKey.EVENT,
            enabled: false,
          }),
        );

        return savedUser;
      });

      this.logger.log(`심사용 계정을 새로 만듦 (userId=${user.id})`);

      return Number(user.id);
    } catch (error) {
      // 두 기기에서 동시에 처음 로그인해 다른 요청이 먼저 만든 경우
      if (isDuplicateEntryError(error)) {
        const userId = await this.findUserId(
          AuthProvider.REVIEW,
          REVIEW_PROVIDER_USER_ID,
        );

        if (userId) {
          return userId;
        }
      }

      throw error;
    }
  }

  private toNewUserResponse(
    provider: AuthProvider,
    providerUserId: string,
    suggestedNickname: string | null,
    email: string | null,
    appleRefreshToken: string | null,
  ) {
    return {
      isNewUser: true as const,
      signupToken: signSignupToken(
        provider,
        providerUserId,
        email,
        appleRefreshToken,
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

  // 길이가 달라도 시간이 크게 차이 나지 않도록 해시끼리 비교한다
  private isSameText(a: string, b: string) {
    return this.isSameHash(this.hashToken(a), this.hashToken(b));
  }

  private isSameHash(a: string, b: string) {
    return (
      a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
    );
  }
}
