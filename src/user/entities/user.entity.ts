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

  @Column({
    name: 'image_data',
    type: 'longblob',
    nullable: true,
    select: false,
  })
  imageData!: Buffer | null;

  @Column({
    name: 'image_mime_type',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  imageMimeType!: string | null;

  @Column({
    name: 'image_size',
    type: 'bigint',
    nullable: true,
  })
  imageSize!: number | null;

  @Column({ name: 'user_code', type: 'varchar', length: 30, unique: true })
  userCode!: string;

  @Column({ type: 'varchar', length: 50 })
  nickname!: string;

  @OneToMany(() => RecordEntity, (record) => record.user)
  records!: RecordEntity[];
}