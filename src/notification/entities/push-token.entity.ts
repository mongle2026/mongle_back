import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// 기기별 Expo 푸시 토큰. 한 사용자가 여러 기기를 쓸 수 있어서 user 와 1:N.
// 같은 기기에서 다른 계정으로 바꾸면 토큰 주인만 바뀌도록 token 을 unique 로 둔다.
@Index('idx_push_token_user_id', ['userId'])
@Index('uq_push_token_token', ['token'], { unique: true })
@Entity('push_token')
export class PushTokenEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ type: 'varchar', length: 255 })
  token!: string;

  // ios | android
  @Column({ type: 'varchar', length: 10 })
  platform!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
