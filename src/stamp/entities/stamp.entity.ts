import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('stamp')
export class StampEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  // 프론트 envelopeData.js의 STAMPS[].id와 동일한 값 (예: 's10'). 이미지/이름은
  // 계속 프론트에서 관리하며, 이 테이블은 "유효한 코드 전체 목록"만 갖는다.
  @Column({ type: 'varchar', unique: true })
  code!: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
