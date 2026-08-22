import {
  Column,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Visibility } from '../enums/visibility.enum';
import { FeedFont } from '../enums/feed-font.enum';
import { RecordEntity } from '../../record/entities/record.entity';
import { FeedLikeEntity } from '../../like/entities/feed-like.entity';
import { BookmarkEntity } from '../../bookmark/entities/bookmark.entity';
import { FeedCommentEntity } from '../../feed-comment/entities/feed-comment.entity';

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

  @Column({
    name: 'font',
    type: 'varchar',
    length: 20,
    default: FeedFont.KYOBO,
  })
  font!: FeedFont;

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