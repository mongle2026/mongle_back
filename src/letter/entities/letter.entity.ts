import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RecordEntity } from '../../record/entities/record.entity';
import { StampEntity } from '../../stamp/entities/stamp.entity';
import { UserEntity } from '../../user/entities/user.entity';

@Index('idx_letter_receiver_read_id', ['receiverId', 'isRead', 'id'])
@Index('idx_letter_receiver_id', ['receiverId', 'id'])
@Index('idx_letter_sender_id', ['senderId', 'id'])
@Index('idx_letter_receiver_stamp_created', [
  'receiverId',
  'stamp',
  'createdAt',
])
@Entity('letter')
export class LetterEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'record_id', type: 'bigint' })
  recordId!: number;

  @ManyToOne(() => RecordEntity, { nullable: false })
  @JoinColumn({ name: 'record_id' })
  record!: RecordEntity;

  // record.userId를 편지 생성 시점에 복사해둔 값. 탭별(보낸/전체/나에게씀) 목록 조회를
  // record 조인 없이 letter 인덱스만으로 필터링하기 위함. record.userId는 이후 수정되지
  // 않으므로 drift 걱정 없음 — 절대 이 컬럼만 단독으로 업데이트하지 말 것.
  @Column({ name: 'sender_id', type: 'bigint' })
  senderId!: number;

  @Column({ name: 'receiver_id', type: 'bigint' })
  receiverId!: number;

  // 컬럼/관계가 아닌 조회용 필드. 편지함 목록에서 leftJoinAndMapOne 으로 채운다.
  receiver?: UserEntity | null;

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

  @ManyToOne(() => StampEntity, { nullable: false })
  @JoinColumn({ name: 'stamp', referencedColumnName: 'code' })
  stampCatalog!: StampEntity;

  @Column({
    name: 'delivery_at',
    type: 'datetime',
    nullable: true,
  })
  deliveryAt!: Date | null;

  @Column({
    name: 'is_read',
    type: 'boolean',
    default: false,
  })
  isRead!: boolean;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
  })
  createdAt!: Date;
}