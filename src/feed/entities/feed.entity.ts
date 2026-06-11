import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Visibility } from '../enums/visibility.enum';
import { RecordEntity } from 'src/record/entities/record.entity';

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
}