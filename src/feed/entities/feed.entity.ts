import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Visibility } from '../enums/visibility.enum';
import { RecordEntity } from 'src/record/entities/record.entity';
import { FeedLikeEntity } from 'src/like/entities/feed-like.entity';
import { BookmarkEntity } from 'src/bookmark/entities/bookmark.entity';

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

  @OneToMany(() => FeedLikeEntity, (like) => like.feed)
  likes!: FeedLikeEntity[];

  @OneToMany(() => BookmarkEntity, (bookmark) => bookmark.feed)
  bookmarks!: BookmarkEntity[];
}