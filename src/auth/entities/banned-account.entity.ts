import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { AuthProvider } from '../../user/enums/auth-provider.enum';
import { ReportReason } from '../../report/enums/report.enum';

/**
 * 일정 기간 다시 가입할 수 없는 소셜 계정. 이용 제한 중에 탈퇴하면 남긴다 (withdrawal.service.ts).
 * - 영구 정지된 회원 (본인 탈퇴 · 운영자가 탈퇴시킴): 탈퇴 후 1년
 * - 기간 정지 중 본인 탈퇴: 정지가 끝나는 시각까지
 * 탈퇴하면 user.provider_user_id 가 비워지므로, 같은 소셜 계정을 알아볼 수 있게 여기에 옮겨 둔다.
 * 이 소셜 계정으로 로그인 · 가입하면 expires_at 전까지 403 ACCOUNT_BANNED 로 막는다 (auth.service.ts).
 * expires_at 이 지나면 보관 기간 정리 크론이 행을 지운다 (report/retention). 일찍 풀어 주려면 운영자가 행을 지운다.
 */
@Entity('banned_account')
@Unique('UQ_banned_account_provider_user_id', ['provider', 'providerUserId'])
@Index('IDX_banned_account_expires_at', ['expiresAt'])
export class BannedAccountEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'varchar', length: 10 })
  provider!: AuthProvider;

  @Column({ name: 'provider_user_id', type: 'varchar', length: 100 })
  providerUserId!: string;

  // 탈퇴시킨 회원 (user 행은 탈퇴해도 남는다)
  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @ManyToOne(() => UserEntity)
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_banned_account_user_id',
  })
  user!: UserEntity;

  // 탈퇴시킬 때의 영구 정지 사유 (user.restricted_reason)
  @Column({ type: 'varchar', length: 20, nullable: true })
  reason!: ReportReason | null;

  // 탈퇴시킨 운영자의 디스코드 사용자 id. 본인이 탈퇴했거나 터미널로 처리했으면 null
  @Column({ name: 'banned_by', type: 'varchar', length: 32, nullable: true })
  bannedBy!: string | null;

  // 이 시각부터 다시 가입할 수 있다.
  // null 은 이 컬럼이 생기기 전에 남긴 행이 마이그레이션 전에 잠깐 갖는 값이라, 막힌 것으로 본다 (마이그레이션이 채운다)
  @Column({ name: 'expires_at', type: 'datetime', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
