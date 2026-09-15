import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StampController } from './stamp.controller';
import { StampService } from './stamp.service';
import { StampEntity } from './entities/stamp.entity';

@Module({
  imports: [TypeOrmModule.forFeature([StampEntity])],
  controllers: [StampController],
  providers: [StampService],
  exports: [TypeOrmModule],
})
export class StampModule {}
