import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NotificationSettingKey } from '../enums/notification.enum';

// 사용자가 바꾼 설정만 행으로 남는다. 행이 없으면 NOTIFICATION_SETTING_DEFAULTS 값을 쓴다.
// 이벤트 알림은 광고성 정보라 동의/철회 시각(updated_at)을 보관해야 한다.
@Index('uq_notification_setting_user_key', ['userId', 'settingKey'], {
  unique: true,
})
@Entity('notification_setting')
export class NotificationSettingEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ name: 'setting_key', type: 'varchar', length: 30 })
  settingKey!: NotificationSettingKey;

  @Column({ type: 'boolean' })
  enabled!: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
