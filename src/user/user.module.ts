import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { ProfileImageService } from './profile-image.service';
import { ProfileImageCleanupService } from './profile-image-cleanup.service';
import { ProfileImagePendingEntity } from './entities/profile-image-pending.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, ProfileImagePendingEntity])],
  controllers: [UserController],
  providers: [UserService, ProfileImageService, ProfileImageCleanupService],
  exports: [UserService, ProfileImageService],
})
export class UserModule {}
