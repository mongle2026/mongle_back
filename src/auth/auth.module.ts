import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { KakaoApiService } from './kakao-api.service';
import { AppleApiService } from './apple-api.service';
import { WithdrawalService } from './withdrawal.service';
import { SocialUnlinkService } from './social-unlink.service';
import { SocialUnlinkPendingEntity } from './entities/social-unlink-pending.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, SocialUnlinkPendingEntity]),
    UserModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    KakaoApiService,
    AppleApiService,
    WithdrawalService,
    SocialUnlinkService,
  ],
})
export class AuthModule {}
