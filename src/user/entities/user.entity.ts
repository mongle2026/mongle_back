import {
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RecordEntity } from '../../record/entities/record.entity';

@Entity('user')
export class UserEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'bigint', unique: true })
  kakaoId!: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'image_mime_type', type: 'varchar', length: 50, nullable: true })
  imageMimeType!: string | null; // 유지: null이면 "프로필 이미지 없음" 플래그로 계속 사용

  @Column({ name: 'image_updated_at', type: 'datetime', nullable: true })
  imageUpdatedAt!: Date | null; // 캐시 무효화용 (?v=timestamp)


  @Column({ name: 'user_code', type: 'varchar', length: 30, unique: true })
  userCode!: string;

  @Column({ type: 'varchar', length: 50 })
  nickname!: string;

  @OneToMany(() => RecordEntity, (record) => record.user)
  records!: RecordEntity[];
}