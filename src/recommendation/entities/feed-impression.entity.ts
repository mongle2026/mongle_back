import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { FeedEntity } from '../../feed/entities/feed.entity';

/**
 * 추천 피드가 회원에게 내려준 글. "이미 노출된 게시물은 상단에 올리지 않는다" 규칙과
 * 다음 페이지에서 같은 글을 다시 주지 않는 데 쓴다. 앱이 실제로 화면에 띄웠는지는 따지지 않는다.
 * 회원 · 글마다 한 줄만 두고, 다시 내려주면 served_at 만 바꾼다.
 * 보관 기간(recommendation.config.ts seen.retentionDays)이 지나면 크론이 지운다.
 */
@Entity('feed_impression')
@Unique('UQ_feed_impression_user_feed', ['userId', 'feedId'])
@Index('IDX_feed_impression_user_served', ['userId', 'servedAt'])
@Index('IDX_feed_impression_served_at', ['servedAt'])
export class FeedImpressionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ name: 'feed_id', type: 'bigint' })
  feedId!: number;

  @Column({ name: 'served_at', type: 'datetime' })
  servedAt!: Date;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_feed_impression_user_id',
  })
  user!: UserEntity;

  @ManyToOne(() => FeedEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'feed_id',
    foreignKeyConstraintName: 'FK_feed_impression_feed_id',
  })
  feed!: FeedEntity;
}
