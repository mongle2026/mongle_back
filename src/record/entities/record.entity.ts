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
import { UserEntity } from 'src/user/entities/user.entity';
import { RecordFileEntity } from './record-file.entity';
import { MusicEntity } from 'src/music/entities/music.entity';

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