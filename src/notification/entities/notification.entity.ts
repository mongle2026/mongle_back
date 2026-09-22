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

// 알림 목록 한 줄. 원본(편지/댓글)이 지워져도 목록에서는 남겨두기로 해서
// letter_id / feed_id / comment_id 에는 외래키를 걸지 않는다.
@Index('idx_notification_user_id', ['userId', 'id'])
@Index('idx_notification_user_type_id', ['userId', 'type', 'id'])
@Index('idx_notification_created_at', ['createdAt'])
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
  // 편지 send: 받는 사람, 편지 receive: 보낸 사람, 댓글/답글: 작성자, 소식: null
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

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
