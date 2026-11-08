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
import { ReportReason, ReportTargetType } from '../../enums/report.enum';
import { SanctionRestriction, SanctionType } from '../sanction.constants';

/**
 * 회원 제재 이력 (경고 · 영구 정지). 신고를 처리할 때 남긴다.
 *
 * - 유효한 경고: type = WARNING, revoked_at 이 null, expires_at 이 지나지 않음. 이 개수로 이용 정지를 정한다
 * - 제재로 이용 제한이 바뀌었으면 restriction · restricted_at · restricted_until 에 바꾼 값을,
 *   prev_* 에 바꾸기 전 값을 남긴다. 신고 처리를 되돌리면 회원의 제한이 그대로일 때만 이전 값으로 돌린다
 * - 되돌린 제재는 지우지 않고 revoked_at 을 채운다
 */
@Entity('user_sanction')
@Index('IDX_user_sanction_user_type_expires_at', [
  'userId',
  'type',
  'expiresAt',
])
@Index('IDX_user_sanction_target', ['targetType', 'targetId'])
export class UserSanctionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @ManyToOne(() => UserEntity)
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_user_sanction_user_id',
  })
  user!: UserEntity;

  @Column({ type: 'varchar', length: 20 })
  type!: SanctionType;

  // 운영자가 처리 버튼을 누른 신고. 같은 대상의 다른 신고도 함께 처리된다
  @Column({ name: 'report_id', type: 'bigint' })
  reportId!: number;

  // 신고 대상 (report.target_type / target_id). 되돌릴 때 이 대상의 제재를 찾는다
  @Column({ name: 'target_type', type: 'varchar', length: 20 })
  targetType!: ReportTargetType;

  @Column({ name: 'target_id', type: 'bigint' })
  targetId!: number;

  @Column({ type: 'varchar', length: 20 })
  reason!: ReportReason;

  // 경고가 사라지는 시각 (부여 + 6개월). 영구 정지(BAN)는 null
  @Column({ name: 'expires_at', type: 'datetime', nullable: true })
  expiresAt!: Date | null;

  // 이 제재로 내려진 이용 제한. 제한이 바뀌지 않았으면 null (경고 1회, 이미 더 무거운 제한 중 등)
  @Column({ type: 'varchar', length: 20, nullable: true })
  restriction!: SanctionRestriction | null;

  // 이 제재로 회원에게 넣은 user.restricted_at / restricted_until. restriction 이 null 이면 둘 다 null
  @Column({ name: 'restricted_at', type: 'datetime', nullable: true })
  restrictedAt!: Date | null;

  @Column({ name: 'restricted_until', type: 'datetime', nullable: true })
  restrictedUntil!: Date | null;

  // 이 제재 직전 회원의 이용 제한. 제한 중이 아니었으면 모두 null
  @Column({ name: 'prev_restricted_at', type: 'datetime', nullable: true })
  prevRestrictedAt!: Date | null;

  @Column({ name: 'prev_restricted_until', type: 'datetime', nullable: true })
  prevRestrictedUntil!: Date | null;

  @Column({
    name: 'prev_restricted_reason',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  prevRestrictedReason!: ReportReason | null;

  // 처리한 운영자의 디스코드 사용자 id. 터미널로 처리했으면 null
  @Column({ name: 'handled_by', type: 'varchar', length: 32, nullable: true })
  handledBy!: string | null;

  // 신고 처리를 되돌려 없앤 시각
  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
