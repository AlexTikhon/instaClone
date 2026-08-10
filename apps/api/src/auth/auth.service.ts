import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { AuthenticatedUser, LoginInput, RegisterInput } from '@instaclone/api-contracts';

import {
  IDENTITY_REPOSITORY,
  IdentityConflictError,
  type IdentityRepository,
} from '../identity/identity.repository';
import type { IdentityRecord } from '../identity/identity.types';
import { AuthTokensService } from './auth-tokens.service';
import { PasswordService } from './password.service';

export interface SessionIssue {
  user: AuthenticatedUser;
  sessionId: string;
  refreshToken: string;
}

const toAuthenticatedUser = (identity: IdentityRecord): AuthenticatedUser => ({
  id: identity.id,
  email: identity.email,
  profile: identity.profile,
});

@Injectable()
export class AuthService {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: AuthTokensService,
  ) {}

  async register(input: RegisterInput): Promise<SessionIssue> {
    const { password, ...identityInput } = input;
    const sessionId = randomUUID();
    const refreshToken = this.tokens.createRefreshToken(sessionId);
    const sessionExpiresAt = new Date(Date.now() + this.tokens.refreshLifetimeMs);

    try {
      const { identity } = await this.identities.createIdentityWithSession({
        ...identityInput,
        passwordHash: await this.passwords.hash(password),
        sessionId,
        refreshTokenHash: this.tokens.hashRefreshToken(refreshToken),
        sessionExpiresAt,
      });
      return { user: toAuthenticatedUser(identity), sessionId, refreshToken };
    } catch (error) {
      if (error instanceof IdentityConflictError) {
        throw new ConflictException('Email or username is already in use');
      }
      throw error;
    }
  }

  async login(input: LoginInput): Promise<SessionIssue> {
    const identity = await this.identities.findByEmail(input.email);
    const passwordMatches = identity
      ? await this.passwords.verify(identity.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);
    if (!identity || !passwordMatches || identity.disabledAt) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const sessionId = randomUUID();
    const refreshToken = this.tokens.createRefreshToken(sessionId);
    await this.identities.createSession(
      sessionId,
      identity.id,
      this.tokens.hashRefreshToken(refreshToken),
      new Date(Date.now() + this.tokens.refreshLifetimeMs),
    );
    return { user: toAuthenticatedUser(identity), sessionId, refreshToken };
  }

  async refresh(refreshToken: string): Promise<SessionIssue> {
    const sessionId = this.tokens.readRefreshSessionId(refreshToken);
    if (!sessionId) throw new UnauthorizedException('Invalid refresh session');

    const session = await this.identities.findSession(sessionId);
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now || session.identity.disabledAt) {
      throw new UnauthorizedException('Invalid refresh session');
    }

    const nextRefreshToken = this.tokens.createRefreshToken(sessionId);
    const result = await this.identities.rotateRefreshToken(
      sessionId,
      this.tokens.hashRefreshToken(refreshToken),
      this.tokens.hashRefreshToken(nextRefreshToken),
      session.expiresAt,
      now,
    );
    if (result !== 'rotated') throw new UnauthorizedException('Invalid refresh session');

    return {
      user: toAuthenticatedUser(session.identity),
      sessionId,
      refreshToken: nextRefreshToken,
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const sessionId = this.tokens.readRefreshSessionId(refreshToken);
    if (sessionId) await this.identities.revokeSession(sessionId, 'LOGOUT');
  }
}
