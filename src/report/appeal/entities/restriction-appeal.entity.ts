import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../../../user/entities/user.entity';
import { ReportReason } from '../../enums/report.enum';

// 이의 신청 처리 상태
export enum AppealStatus {
  // 검토 중
  PENDING = 'PENDING',
  // 받아들여 이용 제한을 풀었다
  ACCEPTED = 'ACCEPTED',
  // 받아들이지 않았다 (제한 유지). 같은 제한에 다시 이의 신청할 수 있다
  REJECTED = 'REJECTED',
  // 검토하기 전에 제한이 먼저 풀렸거나(신고 되돌리기 · 기간 끝남) 다른 제한으로 바뀌어서 닫았다. 회원에게 알리지 않는다
  CLOSED = 'CLOSED',
}

/**
 * 이용 제한 이의 신청. 한 제한에 검토 중(PENDING)인 신청은 하나만 있을 수 있고, 기각되면 다시 낼 수 있다.
 * 같은 제한은 user.restricted_at 으로 구분한다. 제한 중에 기간만 바꾸면 restricted_at 은 그대로라서 같은 제한이다.
 * 제한 사유 · 기간은 신청할 때 값을 복사해 둔다 (나중에 제한이 바뀌거나 풀려도 무엇에 이의를 냈는지 남는다).
 */
@Entity('restriction_appeal')
@Index('IDX_restriction_appeal_user_restricted_at', ['userId', 'restrictedAt'])
@Index('IDX_restriction_appeal_status_created_at', ['status', 'createdAt'])
export class RestrictionAppealEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @ManyToOne(() => UserEntity)
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_restriction_appeal_user_id',
  })
  user!: UserEntity;

  // 이의를 낸 제한이 시작된 시각 (신청할 때의 user.restricted_at)
  @Column({ name: 'restricted_at', type: 'datetime' })
  restrictedAt!: Date;

  // 신청할 때의 user.restricted_until. 영구 제한이면 null
  @Column({ name: 'restricted_until', type: 'datetime', nullable: true })
  restrictedUntil!: Date | null;

  // 신청할 때의 user.restricted_reason
  @Column({
    name: 'restricted_reason',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  restrictedReason!: ReportReason | null;

  @Column({ type: 'varchar', length: 500 })
  content!: string;

  @Column({ type: 'varchar', length: 20, default: AppealStatus.PENDING })
  status!: AppealStatus;

  // 처리한 시각. 처리 전이면 null
  @Column({ name: 'handled_at', type: 'datetime', nullable: true })
  handledAt!: Date | null;

  // 처리한 운영자의 디스코드 사용자 id. 처리 전이면 null
  @Column({ name: 'handled_by', type: 'varchar', length: 32, nullable: true })
  handledBy!: string | null;

  // 디스코드 이의 신청 알림 메시지 id. 웹훅으로 보냈으면 null
  @Column({
    name: 'discord_message_id',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  discordMessageId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
