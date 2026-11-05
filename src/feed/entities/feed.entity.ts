import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Visibility } from '../enums/visibility.enum';
import { RecordEntity } from '../../record/entities/record.entity';
import { FeedLikeEntity } from '../../like/entities/feed-like.entity';
import { BookmarkEntity } from '../../bookmark/entities/bookmark.entity';
import { FeedCommentEntity } from '../../feed-comment/entities/feed-comment.entity';

// 삭제 보관 기간이 지난 피드를 찾는 정리 크론용
@Index('idx_feed_deleted_at', ['deletedAt'])
@Entity('feed')
export class FeedEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'record_id', type: 'bigint' })
  recordId!: number;

  @ManyToOne(() => RecordEntity, { nullable: false })
  @JoinColumn({ name: 'record_id' })
  record!: RecordEntity;

  @Column({
    type: 'char',
    length: 8,
    default: Visibility.PUBLIC,
  })
  visibility!: Visibility;

  // 프로필 노래 커버 그리드에서 뺀 글. 기본은 모두 보이고, 프로필 게시글 편집에서 고르지 않은 글만 true.
  // 피드 목록·상세의 공개 범위(visibility)와는 따로 움직인다
  @Column({ name: 'profile_hidden', type: 'boolean', default: false })
  profileHidden!: boolean;

  // 운영자가 신고를 확인하고 가린 시각. 관리 화면이 없어서 DB 에서 직접 채운다.
  // 가린 글은 작성자를 포함해 모두에게 내용 없이 "가려진 피드"로 내려간다
  @Column({ name: 'blinded_at', type: 'datetime', nullable: true })
  blindedAt!: Date | null;

  @DeleteDateColumn({
    name: 'deleted_at',
    type: 'datetime',
    nullable: true,
  })
  deletedAt!: Date | null;

  @OneToMany(() => FeedLikeEntity, (like) => like.feed)
  likes!: FeedLikeEntity[];

  @OneToMany(() => BookmarkEntity, (bookmark) => bookmark.feed)
  bookmarks!: BookmarkEntity[];

  @OneToMany(() => FeedCommentEntity, (comment) => comment.feed)
  comments!: FeedCommentEntity[];
}