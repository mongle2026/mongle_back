import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { FeedEntity } from '../../feed/entities/feed.entity';

@Entity('bookmark')
@Unique('uq_bookmark_user_feed', ['userId', 'feedId'])
export class BookmarkEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ name: 'feed_id', type: 'bigint' })
  feedId!: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @ManyToOne(() => FeedEntity, (feed) => feed.bookmarks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'feed_id' })
  feed!: FeedEntity;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}