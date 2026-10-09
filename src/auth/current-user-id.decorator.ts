import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from './jwt-auth.guard';

// JwtAuthGuard 가 붙은 핸들러에서 로그인한 사용자 id 를 꺼낸다.
export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): number =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().userId,
);
