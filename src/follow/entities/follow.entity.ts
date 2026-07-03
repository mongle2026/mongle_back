import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  Column,
} from 'typeorm';
import { UserEntity } from 'src/user/entities/user.entity';

@Entity('follow')
@Unique('UQ_follow_follower_following', ['followerId', 'followingId'])
@Index('IDX_follow_follower_id', ['followerId'])
@Index('IDX_follow_following_id', ['followingId'])
export class FollowEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  /**
   * 팔로우를 누른 사람
   */
  @Column({ name: 'follower_id', type: 'bigint' })
  followerId!: number;

  /**
   * 팔로우 당한 사람
   */
  @Column({ name: 'following_id', type: 'bigint' })
  followingId!: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'follower_id' })
  follower!: UserEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'following_id' })
  following!: UserEntity;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}