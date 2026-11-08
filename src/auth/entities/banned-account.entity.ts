import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { AuthProvider } from '../../user/enums/auth-provider.enum';
import { ReportReason } from '../../report/enums/report.enum';

/**
 * 다시 가입할 수 없는 소셜 계정. 운영자가 영구 정지된 회원을 탈퇴시킬 때 남긴다 (신고 처리 withdraw).
 * 탈퇴하면 user.provider_user_id 가 비워지므로, 같은 소셜 계정을 알아볼 수 있게 여기에 옮겨 둔다.
 * 이 소셜 계정으로 로그인 · 가입하면 403 ACCOUNT_BANNED 로 막는다 (auth.service.ts).
 * 풀어 주려면 운영자가 행을 지운다.
 */
@Entity('banned_account')
@Unique('UQ_banned_account_provider_user_id', ['provider', 'providerUserId'])
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

  // 탈퇴시킨 운영자의 디스코드 사용자 id. 터미널로 처리했으면 null
  @Column({ name: 'banned_by', type: 'varchar', length: 32, nullable: true })
  bannedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
