import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import {
  NotificationStatus,
  NotificationType,
} from '../enums/notification.enum';
import { ReportTargetType } from '../../report/enums/report.enum';
import { SanctionNotice } from '../../report/sanction/sanction.constants';

// 알림 목록 한 줄. 원본(편지/댓글)이 지워져도 목록에서는 남겨두기로 해서
// letter_id / feed_id / comment_id 에는 외래키를 걸지 않는다.
@Index('idx_notification_user_id', ['userId', 'id'])
@Index('idx_notification_user_type_id', ['userId', 'type', 'id'])
@Index('idx_notification_created_at', ['createdAt'])
@Index('idx_notification_push_pending', ['pushPending', 'userId'])
@Entity('notification')
export class NotificationEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  // 알림을 받는 사람
  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ type: 'varchar', length: 20 })
  type!: NotificationType;

  @Column({ type: 'varchar', length: 20 })
  status!: NotificationStatus;

  // 목록에 이름/프로필로 보이는 상대방.
  // 편지 send: 받는 사람, 편지 receive: 보낸 사람, 댓글/답글: 작성자, 팔로우: 팔로우한 사람, 소식: null
  @Column({ name: 'actor_id', type: 'bigint', nullable: true })
  actorId!: number | null;

  @ManyToOne(() => UserEntity, {
    nullable: true,
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'actor_id' })
  actor!: UserEntity | null;

  @Column({ name: 'letter_id', type: 'bigint', nullable: true })
  letterId!: number | null;

  @Column({ name: 'feed_id', type: 'bigint', nullable: true })
  feedId!: number | null;

  @Column({ name: 'comment_id', type: 'bigint', nullable: true })
  commentId!: number | null;

  // 댓글/답글 본문. 원본 댓글이 지워져도 목록 문구가 남도록 만들 때 복사해 둔다.
  @Column({ type: 'varchar', length: 500, nullable: true })
  content!: string | null;

  @Column({ name: 'event_title', type: 'varchar', length: 100, nullable: true })
  eventTitle!: string | null;

  // 신고 처리 알림(report_resolved / report_rejected / policy_notice)의 대상 종류. 문구가 대상마다 다르다
  @Column({ name: 'target_type', type: 'varchar', length: 20, nullable: true })
  targetType!: ReportTargetType | null;

  // 운영정책 안내(policy_notice)에 붙는 제재 내용 (경고 / 7일 정지 / 영구 정지). 예전 안내 · 다른 알림은 null
  @Column({ type: 'varchar', length: 20, nullable: true })
  sanction!: SanctionNotice | null;

  // 운영정책 안내를 보낼 때의 유효한 경고 수. 영구 정지를 바로 내렸거나 다른 알림이면 null
  @Column({
    name: 'warning_count',
    type: 'tinyint',
    unsigned: true,
    nullable: true,
  })
  warningCount!: number | null;

  // 야간 알림을 끈 사람에게 밤에 생긴 알림. 목록에는 바로 보이고 푸시만 아침에 모아서 보낸다.
  @Column({ name: 'push_pending', type: 'boolean', default: false })
  pushPending!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
