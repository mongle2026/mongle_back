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
import {
  ReportReason,
  ReportStatus,
  ReportTargetType,
} from '../enums/report.enum';

// 신고 당시 대상의 내용. 대상 종류마다 모양이 다르다 (report.service.ts 참고)
export type ReportContentSnapshot = Record<string, unknown>;

/**
 * 신고. 같은 사람이 같은 대상을 두 번 신고할 수 없다.
 * 대상(target_type + target_id)은 글이 지워진 뒤에도 신고가 남아야 해서 FK 를 걸지 않는다.
 * 피드 · 댓글은 삭제 30일 뒤 정리 크론이 완전히 지우므로, 신고 당시 내용을 content_snapshot 에 복사해 둔다.
 */
@Entity('report')
@Unique('UQ_report_reporter_target', ['reporterId', 'targetType', 'targetId'])
@Index('IDX_report_target', ['targetType', 'targetId'])
@Index('IDX_report_reported_user_id', ['reportedUserId'])
@Index('IDX_report_status_created_at', ['status', 'createdAt'])
export class ReportEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  /**
   * 신고한 사람
   */
  @Column({ name: 'reporter_id', type: 'bigint' })
  reporterId!: number;

  /**
   * 신고당한 사람. 글 · 댓글 · 편지는 작성자, 회원 신고는 그 회원이다.
   */
  @Column({ name: 'reported_user_id', type: 'bigint' })
  reportedUserId!: number;

  @ManyToOne(() => UserEntity)
  @JoinColumn({
    name: 'reporter_id',
    foreignKeyConstraintName: 'FK_report_reporter_id',
  })
  reporter!: UserEntity;

  @ManyToOne(() => UserEntity)
  @JoinColumn({
    name: 'reported_user_id',
    foreignKeyConstraintName: 'FK_report_reported_user_id',
  })
  reportedUser!: UserEntity;

  @Column({ name: 'target_type', type: 'varchar', length: 20 })
  targetType!: ReportTargetType;

  // feed.id / feed_comment.id / letter.id / user.id (회원은 publicId 가 아니라 내부 id)
  @Column({ name: 'target_id', type: 'bigint' })
  targetId!: number;

  @Column({ type: 'varchar', length: 20 })
  reason!: ReportReason;

  // 신고하면서 적은 내용. 안 적었으면 null
  @Column({ type: 'varchar', length: 200, nullable: true })
  detail!: string | null;

  @Column({ name: 'content_snapshot', type: 'json' })
  contentSnapshot!: ReportContentSnapshot;

  @Column({
    type: 'varchar',
    length: 20,
    default: ReportStatus.PENDING,
  })
  status!: ReportStatus;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
