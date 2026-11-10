import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEventEntity } from './entities/user-event.entity';
import { UserEventService } from './user-event.service';
import { UserEventController } from './user-event.controller';

// 사용자 행동 기록. 무엇을 언제 남기는지는 enums/user-event.enum.ts, 추천에 쓰는 방법은 src/recommendation/README.md
@Module({
  imports: [TypeOrmModule.forFeature([UserEventEntity])],
  controllers: [UserEventController],
  providers: [UserEventService],
  exports: [UserEventService],
})
export class UserEventModule { }
