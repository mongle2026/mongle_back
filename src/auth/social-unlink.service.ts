import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { AuthProvider } from '../user/enums/auth-provider.enum';
import { SocialUnlinkPendingEntity } from './entities/social-unlink-pending.entity';
import { KakaoApiService } from './kakao-api.service';
import { AppleApiService } from './apple-api.service';

const MINUTE_MS = 60_000;
// 실패하면 5분, 10분, 20분... 으로 늘리고 6시간을 넘기지 않는다. 10번이면 하루쯤 걸린다.
const RETRY_BASE_MINUTES = 5;
const RETRY_MAX_MINUTES = 6 * 60;
const MAX_ATTEMPTS = 10;
const RETRY_BATCH_SIZE = 100;

const retryDelayMs = (attempts: number) =>
  Math.min(RETRY_BASE_MINUTES * 2 ** (attempts - 1), RETRY_MAX_MINUTES) *
  MINUTE_MS;

export type SocialAccount = {
  provider: AuthProvider;
  providerUserId: string;
  // 애플만. AppleApiService.exchangeCodeForRefreshToken 이 돌려준 값
  appleRefreshToken: string | null;
};

/**
 * 탈퇴한 회원의 소셜 계정 연결 끊기.
 * 카카오/애플 서버 문제로 실패해도 탈퇴는 그대로 두고, social_unlink_pending 에 남겨 다시 시도한다.
 */
@Injectable()
export class SocialUnlinkService {
  private readonly logger = new Logger(SocialUnlinkService.name);
  private isRetrying = false;

  constructor(
    @InjectRepository(SocialUnlinkPendingEntity)
    private readonly pendingRepository: Repository<SocialUnlinkPendingEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly kakaoApiService: KakaoApiService,
    private readonly appleApiService: AppleApiService,
  ) {}

  // 탈퇴 트랜잭션 안에서 부른다. 커밋 뒤에 unlinkNow 로 바로 한 번 시도한다.
  // 그 사이에 크론이 먼저 집어 가지 않도록 첫 재시도 시각은 뒤로 잡아 둔다.
  async enqueue(manager: EntityManager, account: SocialAccount) {
    const pending = await manager.save(
      manager.create(SocialUnlinkPendingEntity, {
        ...account,
        attempts: 0,
        nextAttemptAt: new Date(Date.now() + retryDelayMs(1)),
      }),
    );

    return pending.id;
  }

  // 탈퇴가 커밋된 뒤에 부른다. 실패해도 예외를 던지지 않는다.
  async unlinkNow(pendingId: number) {
    try {
      const pending = await this.pendingRepository.findOneBy({ id: pendingId });

      if (pending) {
        await this.attempt(pending);
      }
    } catch (error) {
      this.logger.error(
        `소셜 연결 끊기 처리 실패 (pendingId=${pendingId})`,
        error as Error,
      );
    }
  }

  @Cron('0 */10 * * * *')
  async retryPending() {
    // 처리가 10분을 넘기면 다음 실행은 건너뛴다
    if (this.isRetrying) {
      return;
    }

    this.isRetrying = true;

    try {
      const pendings = await this.pendingRepository.find({
        where: { nextAttemptAt: LessThanOrEqual(new Date()) },
        order: { nextAttemptAt: 'ASC' },
        take: RETRY_BATCH_SIZE,
      });

      for (const pending of pendings) {
        await this.attempt(pending).catch((error: unknown) =>
          this.logger.error(
            `소셜 연결 끊기 처리 실패 (pendingId=${pending.id})`,
            error as Error,
          ),
        );
      }
    } finally {
      this.isRetrying = false;
    }
  }

  private async attempt(pending: SocialUnlinkPendingEntity) {
    // 기다리는 사이 같은 소셜 계정으로 다시 가입했으면 새 계정의 연결을 끊지 않는다.
    // 탈퇴한 회원은 provider_user_id 를 비우므로, 남아 있는 행은 모두 가입 중인 회원이다.
    const isRegisteredAgain = await this.userRepository.existsBy({
      provider: pending.provider,
      providerUserId: pending.providerUserId,
    });

    if (isRegisteredAgain) {
      await this.pendingRepository.delete({ id: pending.id });
      return;
    }

    try {
      await this.unlink(pending);
    } catch (error) {
      await this.handleFailure(pending, error);
      return;
    }

    await this.pendingRepository.delete({ id: pending.id });
  }

  private async unlink(pending: SocialUnlinkPendingEntity) {
    switch (pending.provider) {
      case AuthProvider.KAKAO:
        await this.kakaoApiService.unlink(pending.providerUserId);
        break;
      case AuthProvider.APPLE:
        if (!pending.appleRefreshToken) {
          throw new Error('애플 refresh token 이 없습니다.');
        }

        await this.appleApiService.revokeRefreshToken(
          pending.appleRefreshToken,
        );
        break;
    }
  }

  private async handleFailure(
    pending: SocialUnlinkPendingEntity,
    error: unknown,
  ) {
    const attempts = pending.attempts + 1;
    // 카카오/애플이 돌려준 에러 본문(예: 401 인증 실패)도 함께 남긴다
    const response = axios.isAxiosError(error)
      ? ` response=${JSON.stringify(error.response?.data)}`
      : '';
    const lastError = `${String(error)}${response}`.slice(0, 500);
    const context = `provider=${pending.provider}, pendingId=${pending.id}, attempts=${attempts}`;

    if (attempts >= MAX_ATTEMPTS) {
      // 더는 시도하지 않는다. 탈퇴한 회원의 소셜 식별값과 토큰을 계속 들고 있지 않도록 행도 지운다.
      this.logger.error(
        `소셜 연결 끊기를 그만둠. 직접 끊어야 한다 (${context}, providerUserId=${pending.providerUserId}) ${lastError}`,
      );
      await this.pendingRepository.delete({ id: pending.id });
      return;
    }

    this.logger.warn(
      `소셜 연결 끊기 실패, 다시 시도 예정 (${context}) ${lastError}`,
    );
    await this.pendingRepository.update(
      { id: pending.id },
      {
        attempts,
        nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)),
        lastError,
      },
    );
  }
}
