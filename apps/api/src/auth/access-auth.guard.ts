import {
  CanActivate,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

import { IDENTITY_REPOSITORY, type IdentityRepository } from '../identity/identity.repository';
import { ACCESS_COOKIE } from './auth.constants';
import type { AuthenticatedRequest } from './authenticated-request';
import { AuthTokensService } from './auth-tokens.service';
import { Inject } from '@nestjs/common';

const readCookie = (request: Request, name: string): unknown => {
  const cookies: unknown = request.cookies;
  return typeof cookies === 'object' && cookies !== null
    ? (cookies as Record<string, unknown>)[name]
    : undefined;
};

@Injectable()
export class AccessAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: AuthTokensService,
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = readCookie(request, ACCESS_COOKIE);
    const claims = typeof token === 'string' ? this.tokens.verifyAccessToken(token) : null;
    if (!claims) throw new UnauthorizedException('Authentication required');

    const session = await this.identities.findSession(claims.sessionId);
    const now = new Date();
    if (
      session?.userId !== claims.userId ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.identity.disabledAt
    ) {
      throw new UnauthorizedException('Authentication required');
    }

    (request as AuthenticatedRequest).identity = {
      id: session.identity.id,
      email: session.identity.email,
      profile: session.identity.profile,
      sessionId: session.id,
    };
    return true;
  }
}
