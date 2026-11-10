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
import { UserEventType } from '../enums/user-event.enum';

/**
 * 사용자 행동 기록 (피드 상세 체류 · 음악 들은 시간 · 좋아요/북마크 및 취소).
 * 이벤트 종류마다 쓰는 칸은 user-event.enum.ts 에 적어 두었다.
 * feed_id · music_id 는 FK 를 걸지 않는다. 글이 지워져도 기록은 남겨 둔다.
 * 보관 기간(user-event.service.ts USER_EVENT_RETENTION_DAYS)이 지나면 크론이 지운다.
 */
@Entity('user_event')
@Index('IDX_user_event_user_occurred', ['userId', 'occurredAt'])
@Index('IDX_user_event_feed_type', ['feedId', 'eventType'])
@Index('IDX_user_event_occurred_at', ['occurredAt'])
export class UserEventEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ name: 'event_type', type: 'varchar', length: 30 })
  eventType!: UserEventType;

  @Column({ name: 'feed_id', type: 'bigint', nullable: true })
  feedId!: number | null;

  // 그 글의 음악. 나중에 글이 지워져도 어떤 음악이었는지 알 수 있게 같이 적는다
  @Column({ name: 'music_id', type: 'bigint', nullable: true })
  musicId!: number | null;

  @Column({ name: 'duration_ms', type: 'int', unsigned: true, nullable: true })
  durationMs!: number | null;

  @Column({ name: 'position_ms', type: 'int', unsigned: true, nullable: true })
  positionMs!: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  detail!: string | null;

  // 일이 일어난 시각. 앱 이벤트는 앱이 보낸 시각(서버 시각 기준으로 7일 전 ~ 지금 사이로 맞춘다), 서버 이벤트는 처리한 시각
  @Column({ name: 'occurred_at', type: 'datetime' })
  occurredAt!: Date;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_user_event_user_id',
  })
  user!: UserEntity;

  // 서버가 받은 시각
  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
