import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StampEntity } from './entities/stamp.entity';

@Module({
  imports: [TypeOrmModule.forFeature([StampEntity])],
  exports: [TypeOrmModule],
})
export class StampModule {}
