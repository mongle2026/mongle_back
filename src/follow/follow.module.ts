import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FollowController } from './follow.controller';
import { FollowService } from './follow.service';
import { FollowEntity } from './entities/follow.entity';
import { UserEntity } from '../user/entities/user.entity';
import { UserModule } from '../user/user.module';

@Module({
  imports: [TypeOrmModule.forFeature([FollowEntity, UserEntity]), UserModule],
  controllers: [FollowController],
  providers: [FollowService],
  exports: [FollowService],
})
export class FollowModule {}
