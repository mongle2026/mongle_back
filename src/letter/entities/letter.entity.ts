import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('letter')
export class LetterEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'record_id', type: 'bigint' })
  recordId!: number;

  // @Column({ name: 'sender_id', type: 'bigint' })
  // senderId!: number;

  @Column({ name: 'receiver_id', type: 'bigint' })
  receiverId!: number;

  @Column({
    name: 'delivery_at',
    type: 'datetime',
    nullable: true,
  })
  deliveryAt!: Date | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
  })
  createdAt!: Date;
}