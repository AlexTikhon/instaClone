import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type {
  AuthenticatedUser,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from '@instaclone/api-contracts';

import {
  IDENTITY_REPOSITORY,
  IdentityConflictError,
  type IdentityRepository,
} from '../identity/identity.repository';
import type {
  AuditEventInput,
  IdentityRecord,
  SessionMetadata,
  SessionSummary,
} from '../identity/identity.types';
import { AuthEmailService } from './auth-email.service';
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
  emailVerified: identity.emailVerifiedAt !== null,
  profile: identity.profile,
});

@Injectable()
export class AuthService {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: AuthTokensService,
    private readonly email: AuthEmailService,
  ) {}

  async register(input: RegisterInput, metadata: SessionMetadata): Promise<SessionIssue> {
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
        sessionMetadata: metadata,
      });
      await this.recordAudit('REGISTER', 'SUCCESS', identity.id, sessionId, metadata);
      await this.sendEmailVerification(identity);
      await this.recordAudit(
        'EMAIL_VERIFICATION_SENT',
        'SUCCESS',
        identity.id,
        sessionId,
        metadata,
      );
      return { user: toAuthenticatedUser(identity), sessionId, refreshToken };
    } catch (error) {
      if (error instanceof IdentityConflictError) {
        throw new ConflictException('Email or username is already in use');
      }
      throw error;
    }
  }

  async login(input: LoginInput, metadata: SessionMetadata): Promise<SessionIssue> {
    const identity = await this.identities.findByEmail(input.email);
    const passwordMatches = identity
      ? await this.passwords.verify(identity.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);
    if (!identity || !passwordMatches || identity.disabledAt) {
      await this.recordAudit('LOGIN_FAILED', 'FAILURE', identity?.id ?? null, null, metadata);
      throw new UnauthorizedException('Invalid email or password');
    }

    const sessionId = randomUUID();
    const refreshToken = this.tokens.createRefreshToken(sessionId);
    await this.identities.createSession(
      sessionId,
      identity.id,
      this.tokens.hashRefreshToken(refreshToken),
      new Date(Date.now() + this.tokens.refreshLifetimeMs),
      metadata,
    );
    await this.recordAudit('LOGIN', 'SUCCESS', identity.id, sessionId, metadata);
    return { user: toAuthenticatedUser(identity), sessionId, refreshToken };
  }

  async refresh(refreshToken: string, metadata: SessionMetadata): Promise<SessionIssue> {
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
    if (result !== 'rotated') {
      if (result === 'reused') {
        await this.recordAudit('REFRESH_REUSE', 'FAILURE', session.userId, sessionId, metadata);
      }
      throw new UnauthorizedException('Invalid refresh session');
    }

    await this.recordAudit('REFRESH', 'SUCCESS', session.userId, sessionId, metadata);
    return {
      user: toAuthenticatedUser(session.identity),
      sessionId,
      refreshToken: nextRefreshToken,
    };
  }

  async logout(refreshToken: string | undefined, metadata: SessionMetadata): Promise<void> {
    if (!refreshToken) return;
    const sessionId = this.tokens.readRefreshSessionId(refreshToken);
    if (!sessionId) return;
    const session = await this.identities.findSession(sessionId);
    await this.identities.revokeSession(sessionId, 'LOGOUT');
    await this.recordAudit('LOGOUT', 'SUCCESS', session?.userId ?? null, sessionId, metadata);
  }

  async resendEmailVerification(userId: string, metadata: SessionMetadata): Promise<void> {
    const identity = await this.identities.findByUserId(userId);
    if (!identity || identity.emailVerifiedAt) return;
    await this.sendEmailVerification(identity);
    await this.recordAudit('EMAIL_VERIFICATION_SENT', 'SUCCESS', identity.id, null, metadata);
  }

  async verifyEmail(token: string, metadata: SessionMetadata): Promise<void> {
    const userId = await this.identities.consumeEmailVerificationToken(
      this.tokens.hashActionToken('email-verification', token),
      new Date(),
    );
    if (!userId) {
      await this.recordAudit('EMAIL_VERIFIED', 'FAILURE', null, null, metadata);
      throw new BadRequestException('Verification token is invalid or expired');
    }
    await this.recordAudit('EMAIL_VERIFIED', 'SUCCESS', userId, null, metadata);
  }

  async forgotPassword(email: string, metadata: SessionMetadata): Promise<void> {
    const identity = await this.identities.findByEmail(email);
    if (!identity || identity.disabledAt) return;
    const token = this.tokens.createActionToken();
    await this.identities.createPasswordResetToken(
      identity.id,
      this.tokens.hashActionToken('password-reset', token),
      new Date(Date.now() + this.tokens.passwordResetLifetimeMs),
    );
    await this.email.sendPasswordReset(identity.email, token);
    await this.recordAudit('PASSWORD_RESET_REQUESTED', 'SUCCESS', identity.id, null, metadata);
  }

  async resetPassword(input: ResetPasswordInput, metadata: SessionMetadata): Promise<void> {
    const userId = await this.identities.resetPassword(
      this.tokens.hashActionToken('password-reset', input.token),
      await this.passwords.hash(input.newPassword),
      new Date(),
    );
    if (!userId) {
      await this.recordAudit('PASSWORD_RESET_COMPLETED', 'FAILURE', null, null, metadata);
      throw new BadRequestException('Reset token is invalid or expired');
    }
    await this.recordAudit('PASSWORD_RESET_COMPLETED', 'SUCCESS', userId, null, metadata);
  }

  async changePassword(
    userId: string,
    sessionId: string,
    input: ChangePasswordInput,
    metadata: SessionMetadata,
  ): Promise<void> {
    const identity = await this.identities.findByUserId(userId);
    if (!identity || !(await this.passwords.verify(identity.passwordHash, input.currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.identities.changePassword(
      userId,
      await this.passwords.hash(input.newPassword),
      new Date(),
    );
    await this.recordAudit('PASSWORD_CHANGED', 'SUCCESS', userId, sessionId, metadata);
  }

  listSessions(userId: string, now = new Date()): Promise<SessionSummary[]> {
    return this.identities.listSessions(userId, now);
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    metadata: SessionMetadata,
  ): Promise<boolean> {
    const revoked = await this.identities.revokeOwnedSession(userId, sessionId);
    if (!revoked) throw new BadRequestException('Session is not active');
    await this.recordAudit('SESSION_REVOKED', 'SUCCESS', userId, sessionId, metadata);
    return true;
  }

  async revokeAllSessions(userId: string, metadata: SessionMetadata): Promise<void> {
    await this.identities.revokeAllSessions(userId, 'SECURITY_EVENT');
    await this.recordAudit('ALL_SESSIONS_REVOKED', 'SUCCESS', userId, null, metadata);
  }

  private async sendEmailVerification(identity: IdentityRecord): Promise<void> {
    const token = this.tokens.createActionToken();
    await this.identities.createEmailVerificationToken(
      identity.id,
      this.tokens.hashActionToken('email-verification', token),
      new Date(Date.now() + this.tokens.emailVerificationLifetimeMs),
    );
    await this.email.sendEmailVerification(identity.email, token);
  }

  private recordAudit(
    eventType: AuditEventInput['eventType'],
    outcome: AuditEventInput['outcome'],
    userId: string | null,
    sessionId: string | null,
    metadata: SessionMetadata,
  ): Promise<void> {
    return this.identities.recordAuditEvent({
      eventType,
      outcome,
      userId,
      sessionId,
      ...metadata,
    });
  }
}
