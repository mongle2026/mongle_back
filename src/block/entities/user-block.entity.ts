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

/**
 * 회원 차단. 한쪽이 차단하면 서로의 글 · 댓글 · 편지 · 알림이 보이지 않는다 (양방향).
 * 반대 방향 조회(나를 차단한 사람)를 위해 blocked_id 인덱스를 따로 둔다.
 */
@Entity('user_block')
@Unique('UQ_user_block_blocker_blocked', ['blockerId', 'blockedId'])
@Index('IDX_user_block_blocked_id', ['blockedId'])
export class UserBlockEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  /**
   * 차단한 사람
   */
  @Column({ name: 'blocker_id', type: 'bigint' })
  blockerId!: number;

  /**
   * 차단당한 사람
   */
  @Column({ name: 'blocked_id', type: 'bigint' })
  blockedId!: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'blocker_id',
    foreignKeyConstraintName: 'FK_user_block_blocker_id',
  })
  blocker!: UserEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'blocked_id',
    foreignKeyConstraintName: 'FK_user_block_blocked_id',
  })
  blocked!: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
