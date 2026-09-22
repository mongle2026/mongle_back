import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { ExpoPushService } from './expo-push.service';
import { NotificationEntity } from './entities/notification.entity';
import { PushTokenEntity } from './entities/push-token.entity';
import { NotificationSettingEntity } from './entities/notification-setting.entity';
import { UserEntity } from '../user/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NotificationEntity,
      PushTokenEntity,
      NotificationSettingEntity,
      UserEntity,
    ]),
  ],
  controllers: [NotificationController],
  providers: [NotificationService, ExpoPushService],
  exports: [NotificationService],
})
export class NotificationModule {}
