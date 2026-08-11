import {
  CanActivate,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

import { ACCESS_COOKIE } from './auth.constants';
import { AccessSessionAuthenticator } from './access-session-authenticator';
import type { AuthenticatedRequest } from './authenticated-request';

const readCookie = (request: Request, name: string): unknown => {
  const cookies: unknown = request.cookies;
  return typeof cookies === 'object' && cookies !== null
    ? (cookies as Record<string, unknown>)[name]
    : undefined;
};

@Injectable()
export class AccessAuthGuard implements CanActivate {
  constructor(private readonly authenticator: AccessSessionAuthenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = readCookie(request, ACCESS_COOKIE);
    const identity = await this.authenticator.authenticate(
      typeof token === 'string' ? token : null,
    );
    if (!identity) throw new UnauthorizedException('Authentication required');

    (request as AuthenticatedRequest).identity = identity;
    return true;
  }
}
