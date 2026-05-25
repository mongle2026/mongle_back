import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user')
export class UserEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'bigint', unique: true })
  kakaoId!: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  image!: string | null;

  @Column({ type: 'varchar', length: 30 })
  username!: string;

  @Column({ type: 'varchar', length: 50 })
  nickname!: string;
}