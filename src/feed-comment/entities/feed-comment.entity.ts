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
import { FeedEntity } from 'src/feed/entities/feed.entity';
import { UserEntity } from 'src/user/entities/user.entity';

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

  // 실제로 답글을 단 대상 댓글
  @Column({ name: 'parent_comment_id', type: 'bigint', nullable: true })
  parentCommentId!: number | null;

  @ManyToOne(() => FeedCommentEntity, (comment) => comment.children, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parent_comment_id' })
  parentComment!: FeedCommentEntity | null;

  @OneToMany(() => FeedCommentEntity, (comment) => comment.parentComment)
  children!: FeedCommentEntity[];

  // 화면에서 묶일 최상위 댓글
  @Column({ name: 'root_comment_id', type: 'bigint', nullable: true })
  rootCommentId!: number | null;

  @ManyToOne(() => FeedCommentEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'root_comment_id' })
  rootComment!: FeedCommentEntity | null;

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