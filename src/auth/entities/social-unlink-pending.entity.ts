import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuthProvider } from '../../user/enums/auth-provider.enum';

/**
 * 탈퇴한 회원의 소셜 계정(카카오/애플) 연결 끊기를 기다리는 작업.
 *
 * 탈퇴 트랜잭션 안에서 넣으므로, 탈퇴가 롤백되면 이 행도 같이 사라진다.
 * 탈퇴가 커밋된 뒤 바로 한 번 시도하고, 실패하면 재시도 크론이 next_attempt_at 마다 다시 시도한다.
 * 끊기에 성공하거나, 같은 소셜 계정으로 다시 가입했거나, 정해진 횟수를 넘기면 행을 지운다.
 */
@Entity('social_unlink_pending')
export class SocialUnlinkPendingEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'varchar', length: 10 })
  provider!: AuthProvider;

  // 탈퇴하면 user 에서는 지우는 값이라 여기에 따로 둔다
  @Column({ name: 'provider_user_id', type: 'varchar', length: 100 })
  providerUserId!: string;

  // 애플만. 탈퇴 직전에 받은 refresh token 을 암호화한 값 (AppleApiService 참고)
  @Column({
    name: 'apple_refresh_token',
    type: 'varchar',
    length: 1000,
    nullable: true,
  })
  appleRefreshToken!: string | null;

  // 지금까지 실패한 횟수
  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Index('IDX_social_unlink_pending_next_attempt_at')
  @Column({ name: 'next_attempt_at', type: 'datetime' })
  nextAttemptAt!: Date;

  // 마지막 실패 이유. 운영 중 확인용
  @Column({ name: 'last_error', type: 'varchar', length: 500, nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
