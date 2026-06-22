import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RecordEntity } from 'src/record/entities/record.entity';

@Entity('letter')
export class LetterEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'record_id', type: 'bigint' })
  recordId!: number;

  @ManyToOne(() => RecordEntity, { nullable: false })
  @JoinColumn({ name: 'record_id' })
  record!: RecordEntity;

  @Column({ name: 'receiver_id', type: 'bigint' })
  receiverId!: number;

  @Column({
    name: 'pattern',
    type: 'varchar',
  })
  pattern!: string;

  @Column({
    name: 'color',
    type: 'varchar',
  })
  color!: string;

  @Column({
    name: 'stamp',
    type: 'varchar',
  })
  stamp!: string;

  @Column({
    name: 'delivery_at',
    type: 'datetime',
    nullable: true,
  })
  deliveryAt!: Date | null;
}