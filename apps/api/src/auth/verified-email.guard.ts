import { CanActivate, ForbiddenException, Injectable, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from './authenticated-request';

@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.identity.emailVerified) {
      throw new ForbiddenException('Email verification is required');
    }
    return true;
  }
}
