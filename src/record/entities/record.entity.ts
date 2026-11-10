import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { RecordFileEntity } from './record-file.entity';
import { MusicEntity } from '../../music/entities/music.entity';
import { RecordFont } from '../enums/record-font.enum';

// 추천 피드 후보를 최근 N일 글로 거를 때 쓴다 (recommendation.service.ts loadCandidatePool)
@Index('IDX_record_created_at', ['createdAt'])
@Entity('record')
export class RecordEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ name: 'music_id', type: 'bigint' })
  musicId!: number;

  @ManyToOne(() => MusicEntity)
  @JoinColumn({ name: 'music_id' })
  music!: MusicEntity;

  @Column({
    type: 'varchar',
    length: 2000,
    nullable: true,
  })
  text!: string | null;

  @Column({
    name: 'font',
    type: 'varchar',
    length: 20,
    default: RecordFont.KYOBO,
  })
  font!: RecordFont;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @OneToMany(() => RecordFileEntity, (file) => file.record)
  files!: RecordFileEntity[];

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
}