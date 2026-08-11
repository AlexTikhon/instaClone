import { Inject, Injectable } from '@nestjs/common';

import { IDENTITY_REPOSITORY, type IdentityRepository } from '../identity/identity.repository';
import type { RequestIdentity } from './authenticated-request';
import { AuthTokensService } from './auth-tokens.service';

@Injectable()
export class AccessSessionAuthenticator {
  constructor(
    private readonly tokens: AuthTokensService,
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
  ) {}

  async authenticate(token: string | null): Promise<RequestIdentity | null> {
    const claims = token ? this.tokens.verifyAccessToken(token) : null;
    if (!claims) return null;

    const session = await this.identities.findSession(claims.sessionId);
    const now = new Date();
    if (
      session?.userId !== claims.userId ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.identity.disabledAt
    ) {
      return null;
    }

    return {
      id: session.identity.id,
      email: session.identity.email,
      emailVerified: session.identity.emailVerifiedAt !== null,
      profile: session.identity.profile,
      sessionId: session.id,
    };
  }
}
