import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';
import { MusicEntity } from './music.entity';

@Entity('popular_music')
@Index(['rank'], { unique: true })
export class PopularMusicEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'int' })
  rank!: number;

  @ManyToOne(() => MusicEntity, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'music_id' })
  music!: MusicEntity;

  @Column({ name: 'music_id', type: 'bigint' })
  musicId!: number;

  @Column({ name: 'chart_date', type: 'date' })
  chartDate!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}