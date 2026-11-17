import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SanctionService } from './sanction.service';
import { AllowRestricted, JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUserId } from '../../auth/current-user-id.decorator';

/*
 * 회원의 제재 상태 (이용 제한 · 경고).
 * 이용 제한은 모든 API 가 403 ACCOUNT_RESTRICTED 로 먼저 알리고, 제재 화면은 여기서 다시 확인한다.
 * 경고 1회는 제한이 아니라서 403 이 없어 여기서 따로 확인한다.
 */
@Controller('sanction')
@UseGuards(JwtAuthGuard)
export class SanctionController {
  constructor(private readonly sanctionService: SanctionService) {}

  // 제재 화면에서 부르는 API 라서 제한 중에도 막지 않는다.
  // 응답: { isRestricted: false, restrictionLift: { reason } | null }
  //   또는 { isRestricted: true, reason, restrictedAt, restrictedUntil, appealStatus, appealDeadline, rejoinAvailableAt }
  @Get('restriction')
  @AllowRestricted()
  async getRestriction(@CurrentUserId() currentUserId: number) {
    return await this.sanctionService.getRestriction(currentUserId);
  }

  // 풀린 뒤 앱에 처음 들어올 때 보여줄 이용 제한 해제 안내 (제한 중에는 403 ACCOUNT_RESTRICTED).
  // 응답: { restrictionLift: { reason: 'APPEAL_ACCEPTED' | 'REVOKED' | 'EXPIRED' } | null }
  @Get('restriction-lift')
  async getRestrictionLift(@CurrentUserId() currentUserId: number) {
    return {
      restrictionLift:
        await this.sanctionService.getRestrictionLift(currentUserId),
    };
  }

  // 해제 안내 화면에서 몽글 시작하기를 눌렀다
  @Post('restriction-lift/acknowledge')
  @HttpCode(204)
  async acknowledgeRestrictionLift(@CurrentUserId() currentUserId: number) {
    await this.sanctionService.acknowledgeRestrictionLift(currentUserId);
  }

  // 이용 제한 중이면 제재 화면만 보여서 경고 안내는 필요 없다 (제한 중에는 403 ACCOUNT_RESTRICTED)
  // 아직 확인하지 않은 경고 1회. 응답: { warning: { reason, warnedAt } | null }
  @Get('warning')
  async getUnacknowledgedWarning(@CurrentUserId() currentUserId: number) {
    return {
      warning:
        await this.sanctionService.getUnacknowledgedWarning(currentUserId),
    };
  }

  // 경고 안내 화면에서 확인을 눌렀다. 확인하지 않은 경고를 모두 확인한 것으로 남긴다
  @Post('warning/acknowledge')
  @HttpCode(204)
  async acknowledgeWarnings(@CurrentUserId() currentUserId: number) {
    await this.sanctionService.acknowledgeWarnings(currentUserId);
  }

  // 운영정책 안내 · 이용 정지 해제 안내 화면의 제재 상세. 알림 목록의 sanctionId 로 부른다.
  // 정지가 풀린 뒤 알림 목록에서 들어오므로 제한 중에는 막는다 (403 ACCOUNT_RESTRICTED).
  // 응답: { sanctionId, type, reason, targetType, sanctionedAt, restriction, restrictedAt, restrictedUntil,
  //        warnings: [{ warnedAt, targetType }] }
  // 위의 고정 경로(restriction · warning 등)가 먼저 맞도록 맨 아래에 둔다
  @Get(':sanctionId')
  async getSanctionDetail(
    @Param('sanctionId', ParseIntPipe) sanctionId: number,
    @CurrentUserId() currentUserId: number,
  ) {
    return await this.sanctionService.getSanctionDetail(
      currentUserId,
      sanctionId,
    );
  }
}
