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
import { MusicEntity } from '../../music/entities/music.entity';

/**
 * 회원이 미리듣기를 재생해 본 음악. 추천 피드의 취향 신호("재생해 본 음악")로 쓴다.
 * 회원 · 음악마다 한 줄만 두고, 다시 재생하면 횟수와 마지막 재생 시각만 바꾼다 (POST /feed/:feedId/play).
 */
@Entity('music_play')
@Unique('UQ_music_play_user_music', ['userId', 'musicId'])
@Index('IDX_music_play_user_last_played', ['userId', 'lastPlayedAt'])
export class MusicPlayEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ name: 'music_id', type: 'bigint' })
  musicId!: number;

  @Column({ name: 'play_count', type: 'int', unsigned: true, default: 1 })
  playCount!: number;

  @Column({ name: 'last_played_at', type: 'datetime' })
  lastPlayedAt!: Date;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_music_play_user_id',
  })
  user!: UserEntity;

  @ManyToOne(() => MusicEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'music_id',
    foreignKeyConstraintName: 'FK_music_play_music_id',
  })
  music!: MusicEntity;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
