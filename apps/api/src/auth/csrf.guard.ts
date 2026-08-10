import { CanActivate, ForbiddenException, Injectable, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { CSRF_COOKIE } from './auth.constants';
import { AuthTokensService } from './auth-tokens.service';

type CookieRequest = Request & { cookies?: Record<string, unknown> };

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly tokens: AuthTokensService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CookieRequest>();
    if (
      !this.tokens.isValidCsrfPair(request.cookies?.[CSRF_COOKIE], request.headers['x-csrf-token'])
    ) {
      throw new ForbiddenException('CSRF validation failed');
    }
    return true;
  }
}
