import { CanActivate, ForbiddenException, Injectable, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/authenticated-request';

@Injectable()
export class ModeratorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.identity.role !== 'MODERATOR' && request.identity.role !== 'ADMIN') {
      throw new ForbiddenException('Moderator access is required');
    }
    return true;
  }
}
