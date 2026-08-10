import { Injectable } from '@nestjs/common';

import type { Profile } from '@instaclone/api-contracts';

import { PrismaService } from '../infrastructure/database/prisma.service';
import { IdentityConflictError, type IdentityRepository } from './identity.repository';
import type {
  CreateIdentityInput,
  IdentityRecord,
  RotationResult,
  SessionRecord,
  UpdateProfileData,
} from './identity.types';

const identitySelection = {
  credential: true,
  profile: true,
} as const;

interface SelectedUser {
  id: string;
  email: string;
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
      identity,
    };
  }

  async createSession(
    sessionId: string,
    userId: string,
    refreshTokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId,
        expiresAt,
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
