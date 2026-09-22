import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FeedEntity } from '../../feed/entities/feed.entity';
import { UserEntity } from '../../user/entities/user.entity';

@Entity('feed_comment')
export class FeedCommentEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'feed_id', type: 'bigint' })
  feedId!: number;

  @ManyToOne(() => FeedEntity, (feed) => feed.comments, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'feed_id' })
  feed!: FeedEntity;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @ManyToOne(() => UserEntity, {
    nullable: false,
  })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({
    type: 'varchar',
    length: 500,
  })
  content!: string;

  // 답글이 묶이는 원댓글. 원댓글 자신은 null 이다.
  // 답글은 1단계뿐이라 "어떤 답글에 달았는지"는 따로 보관하지 않는다.
  @Column({ name: 'root_comment_id', type: 'bigint', nullable: true })
  rootCommentId!: number | null;

  @ManyToOne(() => FeedCommentEntity, (comment) => comment.replies, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'root_comment_id' })
  rootComment!: FeedCommentEntity | null;

  // 답글을 달 때 선택한 사람. 답글 알림은 이 사람에게만 간다. 원댓글은 null.
  @Column({ name: 'reply_to_user_id', type: 'bigint', nullable: true })
  replyToUserId!: number | null;

  @OneToMany(() => FeedCommentEntity, (comment) => comment.rootComment)
  replies!: FeedCommentEntity[];

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'datetime',
  })
  updatedAt!: Date;

  @DeleteDateColumn({
    name: 'deleted_at',
    type: 'datetime',
    nullable: true,
  })
  deletedAt!: Date | null;
}