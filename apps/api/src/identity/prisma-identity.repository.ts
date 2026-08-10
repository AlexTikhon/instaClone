import { Injectable } from '@nestjs/common';

import type { Profile } from '@instaclone/api-contracts';

import { PrismaService } from '../infrastructure/database/prisma.service';
import { IdentityConflictError, type IdentityRepository } from './identity.repository';
import type {
  AuditEventInput,
  CleanupResult,
  CreateIdentityInput,
  IdentityRecord,
  RotationResult,
  SessionRecord,
  SessionMetadata,
  SessionSummary,
  UpdateProfileData,
} from './identity.types';

const identitySelection = {
  credential: true,
  profile: true,
} as const;

interface SelectedUser {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  disabledAt: Date | null;
  credential?: { passwordHash: string } | null;
  profile?: IdentityRecord['profile'] | null;
}

const toProfile = (profile: Profile): Profile => ({
  userId: profile.userId,
  username: profile.username,
  displayName: profile.displayName,
  bio: profile.bio,
  websiteUrl: profile.websiteUrl,
  isPrivate: profile.isPrivate,
});

const toIdentity = (user: SelectedUser | null): IdentityRecord | null => {
  if (!user?.credential || !user.profile) return null;
  return {
    id: user.id,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    disabledAt: user.disabledAt,
    passwordHash: user.credential.passwordHash,
    profile: toProfile(user.profile),
  };
};

@Injectable()
export class PrismaIdentityRepository implements IdentityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createIdentityWithSession(
    input: CreateIdentityInput,
  ): Promise<{ identity: IdentityRecord; sessionId: string }> {
    const user = await this.runWithConflictMapping(() =>
      this.prisma.user.create({
        data: {
          email: input.email,
          credential: { create: { passwordHash: input.passwordHash } },
          profile: {
            create: { username: input.username, displayName: input.displayName },
          },
          sessions: {
            create: {
              id: input.sessionId,
              expiresAt: input.sessionExpiresAt,
              ipAddress: input.sessionMetadata.ipAddress,
              userAgent: input.sessionMetadata.userAgent,
              refreshTokens: {
                create: {
                  tokenHash: input.refreshTokenHash,
                  expiresAt: input.sessionExpiresAt,
                },
              },
            },
          },
        },
        include: { ...identitySelection, sessions: { select: { id: true }, take: 1 } },
      }),
    );

    const identity = toIdentity(user);
    const sessionId = user.sessions[0]?.id;
    if (!identity || !sessionId) throw new Error('Identity aggregate was not created');
    return { identity, sessionId };
  }

  async findByEmail(email: string): Promise<IdentityRecord | null> {
    return toIdentity(
      await this.prisma.user.findUnique({ where: { email }, include: identitySelection }),
    );
  }

  async findByUserId(userId: string): Promise<IdentityRecord | null> {
    return toIdentity(
      await this.prisma.user.findUnique({ where: { id: userId }, include: identitySelection }),
    );
  }

  async findSession(sessionId: string): Promise<SessionRecord | null> {
    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      include: { user: { include: identitySelection } },
    });
    if (!session) return null;
    const identity = toIdentity(session.user);
    if (!identity) return null;
    return {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      identity,
    };
  }

  async createSession(
    sessionId: string,
    userId: string,
    refreshTokenHash: string,
    expiresAt: Date,
    metadata: SessionMetadata,
  ): Promise<void> {
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId,
        expiresAt,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        refreshTokens: { create: { tokenHash: refreshTokenHash, expiresAt } },
      },
    });
  }

  async rotateRefreshToken(
    sessionId: string,
    presentedTokenHash: string,
    nextTokenHash: string,
    expiresAt: Date,
    now: Date,
  ): Promise<RotationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const token = await transaction.refreshToken.findUnique({
        where: { tokenHash: presentedTokenHash },
        include: { session: true },
      });
      if (token?.sessionId !== sessionId) return 'invalid';
      if (token.consumedAt) {
        await transaction.authSession.updateMany({
          where: { id: sessionId, revokedAt: null },
          data: { revokedAt: now, revokeReason: 'REFRESH_TOKEN_REUSE' },
        });
        return 'reused';
      }
      if (token.expiresAt <= now || token.session.revokedAt || token.session.expiresAt <= now) {
        return 'invalid';
      }

      const consumed = await transaction.refreshToken.updateMany({
        where: { id: token.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        await transaction.authSession.updateMany({
          where: { id: sessionId, revokedAt: null },
          data: { revokedAt: now, revokeReason: 'REFRESH_TOKEN_REUSE' },
        });
        return 'reused';
      }

      await transaction.authSession.update({
        where: { id: sessionId },
        data: {
          lastUsedAt: now,
          refreshTokens: { create: { tokenHash: nextTokenHash, expiresAt } },
        },
      });
      return 'rotated';
    });
  }

  async revokeSession(sessionId: string, reason: 'LOGOUT' | 'SECURITY_EVENT'): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  async revokeOwnedSession(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'SECURITY_EVENT' },
    });
    return result.count === 1;
  }

  async revokeAllSessions(
    userId: string,
    reason: 'PASSWORD_CHANGE' | 'SECURITY_EVENT',
  ): Promise<number> {
    const result = await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    return result.count;
  }

  async listSessions(userId: string, now: Date): Promise<SessionSummary[]> {
    return this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        ipAddress: true,
        userAgent: true,
      },
    });
  }

  async createEmailVerificationToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.deleteMany({
        where: { userId, consumedAt: null },
      }),
      this.prisma.emailVerificationToken.create({ data: { userId, tokenHash, expiresAt } }),
    ]);
  }

  async consumeEmailVerificationToken(tokenHash: string, now: Date): Promise<string | null> {
    return this.prisma.$transaction(async (transaction) => {
      const token = await transaction.emailVerificationToken.findUnique({ where: { tokenHash } });
      if (!token || token.consumedAt || token.expiresAt <= now) return null;
      const consumed = await transaction.emailVerificationToken.updateMany({
        where: { id: token.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return null;
      await transaction.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: now },
      });
      return token.userId;
    });
  }

  async createPasswordResetToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({ where: { userId, consumedAt: null } }),
      this.prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } }),
    ]);
  }

  async resetPassword(tokenHash: string, passwordHash: string, now: Date): Promise<string | null> {
    return this.prisma.$transaction(async (transaction) => {
      const token = await transaction.passwordResetToken.findUnique({ where: { tokenHash } });
      if (!token || token.consumedAt || token.expiresAt <= now) return null;
      const consumed = await transaction.passwordResetToken.updateMany({
        where: { id: token.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return null;
      await transaction.userCredential.update({
        where: { userId: token.userId },
        data: { passwordHash, passwordChangedAt: now },
      });
      await transaction.authSession.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now, revokeReason: 'PASSWORD_CHANGE' },
      });
      return token.userId;
    });
  }

  async changePassword(userId: string, passwordHash: string, now: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userCredential.update({
        where: { userId },
        data: { passwordHash, passwordChangedAt: now },
      }),
      this.prisma.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokeReason: 'PASSWORD_CHANGE' },
      }),
    ]);
  }

  async recordAuditEvent(event: AuditEventInput): Promise<void> {
    await this.prisma.authAuditEvent.create({ data: event });
  }

  async cleanupExpiredAuthState(now: Date, auditBefore: Date): Promise<CleanupResult> {
    const [sessions, verificationTokens, resetTokens, auditEvents] = await this.prisma.$transaction(
      [
        this.prisma.authSession.deleteMany({
          where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: now } }] },
        }),
        this.prisma.emailVerificationToken.deleteMany({
          where: { OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }] },
        }),
        this.prisma.passwordResetToken.deleteMany({
          where: { OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }] },
        }),
        this.prisma.authAuditEvent.deleteMany({ where: { occurredAt: { lt: auditBefore } } }),
      ],
    );
    return {
      sessions: sessions.count,
      verificationTokens: verificationTokens.count,
      resetTokens: resetTokens.count,
      auditEvents: auditEvents.count,
    };
  }

  async findProfileByUsername(username: string): Promise<IdentityRecord['profile'] | null> {
    const profile = await this.prisma.profile.findUnique({ where: { username } });
    return profile ? toProfile(profile) : null;
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileData,
  ): Promise<IdentityRecord['profile']> {
    const profile = await this.runWithConflictMapping(() =>
      this.prisma.profile.update({ where: { userId }, data: input }),
    );
    return toProfile(profile);
  }

  private async runWithConflictMapping<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new IdentityConflictError('Unique identity field is already in use');
      }
      throw error;
    }
  }
}
