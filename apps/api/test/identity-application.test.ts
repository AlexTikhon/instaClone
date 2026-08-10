import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { authResponseSchema, profileSchema } from '@instaclone/api-contracts';

import { AppModule } from '../src/app.module';
import { AuthEmailService } from '../src/auth/auth-email.service';
import {
  IDENTITY_REPOSITORY,
  IdentityConflictError,
  type IdentityRepository,
} from '../src/identity/identity.repository';
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
} from '../src/identity/identity.types';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { ObjectStorageService } from '../src/infrastructure/object-storage/object-storage.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { configureApplication } from '../src/platform/bootstrap';

interface StoredSession extends SessionRecord {
  identity: IdentityRecord;
}

interface StoredToken {
  sessionId: string;
  consumedAt: Date | null;
  expiresAt: Date;
}

interface StoredActionToken {
  userId: string;
  consumedAt: Date | null;
  expiresAt: Date;
}

class InMemoryIdentityRepository implements IdentityRepository {
  readonly identities = new Map<string, IdentityRecord>();
  readonly sessions = new Map<string, StoredSession>();
  readonly refreshTokens = new Map<string, StoredToken>();
  readonly verificationTokens = new Map<string, StoredActionToken>();
  readonly resetTokens = new Map<string, StoredActionToken>();
  readonly auditEvents: AuditEventInput[] = [];

  async createIdentityWithSession(
    input: CreateIdentityInput,
  ): Promise<{ identity: IdentityRecord; sessionId: string }> {
    if (
      [...this.identities.values()].some(
        (identity) =>
          identity.email === input.email || identity.profile.username === input.username,
      )
    ) {
      throw new IdentityConflictError();
    }
    const userId = randomUUID();
    const identity: IdentityRecord = {
      id: userId,
      email: input.email,
      emailVerifiedAt: null,
      disabledAt: null,
      passwordHash: input.passwordHash,
      profile: {
        userId,
        username: input.username,
        displayName: input.displayName,
        bio: '',
        websiteUrl: null,
        isPrivate: false,
      },
    };
    this.identities.set(userId, identity);
    await this.createSession(
      input.sessionId,
      userId,
      input.refreshTokenHash,
      input.sessionExpiresAt,
      input.sessionMetadata,
    );
    return { identity, sessionId: input.sessionId };
  }

  findByEmail(email: string): Promise<IdentityRecord | null> {
    return Promise.resolve(
      [...this.identities.values()].find((identity) => identity.email === email) ?? null,
    );
  }

  findByUserId(userId: string): Promise<IdentityRecord | null> {
    return Promise.resolve(this.identities.get(userId) ?? null);
  }

  findSession(sessionId: string): Promise<SessionRecord | null> {
    return Promise.resolve(this.sessions.get(sessionId) ?? null);
  }

  createSession(
    sessionId: string,
    userId: string,
    refreshTokenHash: string,
    expiresAt: Date,
    metadata: SessionMetadata,
  ): Promise<void> {
    const identity = this.identities.get(userId);
    if (!identity) throw new Error('Missing identity');
    this.sessions.set(sessionId, {
      id: sessionId,
      userId,
      expiresAt,
      revokedAt: null,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      identity,
    });
    this.refreshTokens.set(refreshTokenHash, { sessionId, consumedAt: null, expiresAt });
    return Promise.resolve();
  }

  rotateRefreshToken(
    sessionId: string,
    presentedTokenHash: string,
    nextTokenHash: string,
    expiresAt: Date,
    now: Date,
  ): Promise<RotationResult> {
    const session = this.sessions.get(sessionId);
    const token = this.refreshTokens.get(presentedTokenHash);
    if (!session || token?.sessionId !== sessionId) return Promise.resolve('invalid');
    if (token.consumedAt) {
      session.revokedAt = now;
      return Promise.resolve('reused');
    }
    if (session.revokedAt || session.expiresAt <= now || token.expiresAt <= now) {
      return Promise.resolve('invalid');
    }
    token.consumedAt = now;
    this.refreshTokens.set(nextTokenHash, { sessionId, consumedAt: null, expiresAt });
    return Promise.resolve('rotated');
  }

  revokeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) session.revokedAt = new Date();
    return Promise.resolve();
  }

  revokeOwnedSession(userId: string, sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (session?.userId !== userId || session.revokedAt) return Promise.resolve(false);
    session.revokedAt = new Date();
    return Promise.resolve(true);
  }

  revokeAllSessions(userId: string): Promise<number> {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = new Date();
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  listSessions(userId: string, now: Date): Promise<SessionSummary[]> {
    return Promise.resolve(
      [...this.sessions.values()].filter(
        (session) => session.userId === userId && !session.revokedAt && session.expiresAt > now,
      ),
    );
  }

  createEmailVerificationToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    for (const [hash, token] of this.verificationTokens) {
      if (token.userId === userId && !token.consumedAt) this.verificationTokens.delete(hash);
    }
    this.verificationTokens.set(tokenHash, { userId, expiresAt, consumedAt: null });
    return Promise.resolve();
  }

  consumeEmailVerificationToken(tokenHash: string, now: Date): Promise<string | null> {
    const token = this.verificationTokens.get(tokenHash);
    if (!token || token.consumedAt || token.expiresAt <= now) return Promise.resolve(null);
    token.consumedAt = now;
    const identity = this.identities.get(token.userId);
    if (!identity) return Promise.resolve(null);
    identity.emailVerifiedAt = now;
    return Promise.resolve(token.userId);
  }

  createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    for (const [hash, token] of this.resetTokens) {
      if (token.userId === userId && !token.consumedAt) this.resetTokens.delete(hash);
    }
    this.resetTokens.set(tokenHash, { userId, expiresAt, consumedAt: null });
    return Promise.resolve();
  }

  resetPassword(tokenHash: string, passwordHash: string, now: Date): Promise<string | null> {
    const token = this.resetTokens.get(tokenHash);
    if (!token || token.consumedAt || token.expiresAt <= now) return Promise.resolve(null);
    const identity = this.identities.get(token.userId);
    if (!identity) return Promise.resolve(null);
    token.consumedAt = now;
    identity.passwordHash = passwordHash;
    return this.revokeAllSessions(identity.id).then(() => identity.id);
  }

  changePassword(userId: string, passwordHash: string): Promise<void> {
    const identity = this.identities.get(userId);
    if (!identity) throw new Error('Missing identity');
    identity.passwordHash = passwordHash;
    return this.revokeAllSessions(userId).then(() => undefined);
  }

  recordAuditEvent(event: AuditEventInput): Promise<void> {
    this.auditEvents.push(event);
    return Promise.resolve();
  }

  cleanupExpiredAuthState(now: Date): Promise<CleanupResult> {
    let sessions = 0;
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now || session.revokedAt) {
        this.sessions.delete(id);
        sessions += 1;
      }
    }
    const cleanTokens = (tokens: Map<string, StoredActionToken>): number => {
      let count = 0;
      for (const [hash, token] of tokens) {
        if (token.expiresAt <= now || token.consumedAt) {
          tokens.delete(hash);
          count += 1;
        }
      }
      return count;
    };
    return Promise.resolve({
      sessions,
      verificationTokens: cleanTokens(this.verificationTokens),
      resetTokens: cleanTokens(this.resetTokens),
      auditEvents: 0,
    });
  }

  findProfileByUsername(username: string): Promise<IdentityRecord['profile'] | null> {
    return Promise.resolve(
      [...this.identities.values()].find((identity) => identity.profile.username === username)
        ?.profile ?? null,
    );
  }

  updateProfile(userId: string, input: UpdateProfileData): Promise<IdentityRecord['profile']> {
    const identity = this.identities.get(userId);
    if (!identity) throw new Error('Missing identity');
    if (
      input.username &&
      [...this.identities.values()].some(
        (candidate) => candidate.id !== userId && candidate.profile.username === input.username,
      )
    ) {
      throw new IdentityConflictError();
    }
    identity.profile = { ...identity.profile, ...input };
    return Promise.resolve(identity.profile);
  }
}

const cookieValue = (setCookies: string | string[] | undefined, name: string): string => {
  const values = typeof setCookies === 'string' ? [setCookies] : setCookies;
  const cookie = values?.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`Missing ${name} cookie`);
  return cookie.split(';')[0] ?? '';
};

describe('authentication and profile HTTP flows', () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let repository: InMemoryIdentityRepository;
  let rateLimitsAllowed = true;
  const delivered = { verification: [] as string[], resets: [] as string[] };

  beforeAll(async () => {
    repository = new InMemoryIdentityRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_REPOSITORY)
      .useValue(repository)
      .overrideProvider(AuthEmailService)
      .useValue({
        sendEmailVerification: (_email: string, token: string) => {
          delivered.verification.push(token);
          return Promise.resolve();
        },
        sendPasswordReset: (_email: string, token: string) => {
          delivered.resets.push(token);
          return Promise.resolve();
        },
      })
      .overrideProvider(PrismaService)
      .useValue({ ping: () => Promise.resolve() })
      .overrideProvider(RedisService)
      .useValue({
        ping: () => Promise.resolve(),
        consumeRateLimit: () => Promise.resolve(rateLimitsAllowed ? 60 : -60),
      })
      .overrideProvider(ObjectStorageService)
      .useValue({ ping: () => Promise.resolve() })
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => app.close());

  it('registers, authorizes ownership, rotates refresh tokens, and detects reuse', async () => {
    const agent = request.agent(server);
    const csrfResponse = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrfResponse.body as { csrfToken: string }).csrfToken;
    const csrfCookie = cookieValue(csrfResponse.headers['set-cookie'], 'ic_csrf');

    await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'ada@example.com',
        password: 'a-secure-password',
        username: 'ada.l',
        displayName: 'Ada',
      })
      .expect(403);

    const registration = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'Ada@Example.com',
        password: 'a-secure-password',
        username: 'Ada.L',
        displayName: 'Ada',
      })
      .expect(201);
    expect(authResponseSchema.parse(registration.body).user.email).toBe('ada@example.com');
    const setCookieHeader = registration.headers['set-cookie'];
    const cookies =
      typeof setCookieHeader === 'string' ? [setCookieHeader] : (setCookieHeader ?? []);
    expect(cookies.some((cookie) => /ic_access=.*HttpOnly.*SameSite=Strict/.test(cookie))).toBe(
      true,
    );
    expect(cookies.some((cookie) => /ic_refresh=.*HttpOnly.*SameSite=Strict/.test(cookie))).toBe(
      true,
    );
    const originalRefreshCookie = cookieValue(cookies, 'ic_refresh');

    await agent.get('/api/v1/auth/me').expect(200);

    await agent
      .patch('/api/v1/profiles/me')
      .set('x-csrf-token', csrfToken)
      .send({ bio: 'Not applied', userId: randomUUID() })
      .expect(400);

    await agent
      .patch('/api/v1/profiles/me')
      .set('x-csrf-token', csrfToken)
      .send({ bio: 'Computing pioneer', isPrivate: true })
      .expect(200)
      .expect((response) => {
        expect(profileSchema.parse(response.body)).toMatchObject({
          username: 'ada.l',
          bio: 'Computing pioneer',
          isPrivate: true,
        });
      });

    await agent.get('/api/v1/profiles/ADA.L').expect(200);

    await agent.post('/api/v1/auth/refresh').set('x-csrf-token', csrfToken).expect(200);

    await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [originalRefreshCookie, csrfCookie])
      .set('x-csrf-token', csrfToken)
      .expect(401);

    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('logs in with a new session and revokes it on logout', async () => {
    const agent = request.agent(server);
    const csrfResponse = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrfResponse.body as { csrfToken: string }).csrfToken;

    await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'ada@example.com', password: 'wrong-password' })
      .expect(401);

    await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'ada@example.com', password: 'a-secure-password' })
      .expect(200);
    await agent.get('/api/v1/auth/me').expect(200);
    await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrfToken).expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('resends and consumes email verification tokens', async () => {
    const agent = request.agent(server);
    const csrfResponse = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrfResponse.body as { csrfToken: string }).csrfToken;

    await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'ada@example.com', password: 'a-secure-password' })
      .expect(200);
    await agent
      .post('/api/v1/auth/email/resend')
      .set('x-csrf-token', csrfToken)
      .expect(202)
      .expect({ accepted: true });

    const verificationToken = delivered.verification.at(-1);
    expect(verificationToken).toBeTruthy();
    await agent
      .post('/api/v1/auth/email/verify')
      .set('x-csrf-token', csrfToken)
      .send({ token: verificationToken })
      .expect(204);
    await agent
      .post('/api/v1/auth/email/verify')
      .set('x-csrf-token', csrfToken)
      .send({ token: verificationToken })
      .expect(400);
    await agent
      .get('/api/v1/auth/me')
      .expect(200)
      .expect((response) => {
        const body = response.body as { user: { emailVerified: boolean } };
        expect(body.user.emailVerified).toBe(true);
      });
  });

  it('lists device sessions and revokes one or all owned sessions', async () => {
    const first = request.agent(server);
    const second = request.agent(server);
    const firstCsrf = await first.get('/api/v1/auth/csrf').expect(200);
    const secondCsrf = await second.get('/api/v1/auth/csrf').expect(200);
    const firstToken = (firstCsrf.body as { csrfToken: string }).csrfToken;
    const secondToken = (secondCsrf.body as { csrfToken: string }).csrfToken;
    await first
      .post('/api/v1/auth/login')
      .set('x-csrf-token', firstToken)
      .set('user-agent', 'first-device')
      .send({ email: 'ada@example.com', password: 'a-secure-password' })
      .expect(200);
    await second
      .post('/api/v1/auth/login')
      .set('x-csrf-token', secondToken)
      .set('user-agent', 'second-device')
      .send({ email: 'ada@example.com', password: 'a-secure-password' })
      .expect(200);

    const listed = await first.get('/api/v1/auth/sessions').expect(200);
    const sessions = (
      listed.body as {
        sessions: { id: string; current: boolean; userAgent: string | null }[];
      }
    ).sessions;
    const other = sessions.find((session) => session.userAgent === 'second-device');
    expect(sessions.some((session) => session.current)).toBe(true);
    expect(other).toBeTruthy();
    await first
      .delete(`/api/v1/auth/sessions/${other?.id}`)
      .set('x-csrf-token', firstToken)
      .expect(204);
    await second.get('/api/v1/auth/me').expect(401);
    await first.delete('/api/v1/auth/sessions').set('x-csrf-token', firstToken).expect(204);
    await first.get('/api/v1/auth/me').expect(401);
  });

  it('changes a password and revokes every existing session', async () => {
    const agent = request.agent(server);
    const csrfResponse = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrfResponse.body as { csrfToken: string }).csrfToken;
    await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'ada@example.com', password: 'a-secure-password' })
      .expect(200);
    await agent
      .post('/api/v1/auth/password/change')
      .set('x-csrf-token', csrfToken)
      .send({ currentPassword: 'wrong-password', newPassword: 'a-new-secure-password' })
      .expect(401);
    await agent
      .post('/api/v1/auth/password/change')
      .set('x-csrf-token', csrfToken)
      .send({
        currentPassword: 'a-secure-password',
        newPassword: 'a-new-secure-password',
      })
      .expect(204);
    await agent.get('/api/v1/auth/me').expect(401);

    const login = request.agent(server);
    const loginCsrf = await login.get('/api/v1/auth/csrf').expect(200);
    const loginToken = (loginCsrf.body as { csrfToken: string }).csrfToken;
    await login
      .post('/api/v1/auth/login')
      .set('x-csrf-token', loginToken)
      .send({ email: 'ada@example.com', password: 'a-secure-password' })
      .expect(401);
    await login
      .post('/api/v1/auth/login')
      .set('x-csrf-token', loginToken)
      .send({ email: 'ada@example.com', password: 'a-new-secure-password' })
      .expect(200);
  });

  it('uses enumeration-safe recovery responses and one-time reset tokens', async () => {
    const agent = request.agent(server);
    const csrfResponse = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrfResponse.body as { csrfToken: string }).csrfToken;
    await agent
      .post('/api/v1/auth/password/forgot')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'unknown@example.com' })
      .expect(202)
      .expect({ accepted: true });
    await agent
      .post('/api/v1/auth/password/forgot')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'ada@example.com' })
      .expect(202)
      .expect({ accepted: true });

    const resetToken = delivered.resets.at(-1);
    expect(resetToken).toBeTruthy();
    await agent
      .post('/api/v1/auth/password/reset')
      .set('x-csrf-token', csrfToken)
      .send({ token: resetToken, newPassword: 'reset-secure-password' })
      .expect(204);
    await agent
      .post('/api/v1/auth/password/reset')
      .set('x-csrf-token', csrfToken)
      .send({ token: resetToken, newPassword: 'another-secure-password' })
      .expect(400);

    const login = request.agent(server);
    const loginCsrf = await login.get('/api/v1/auth/csrf').expect(200);
    const loginToken = (loginCsrf.body as { csrfToken: string }).csrfToken;
    await login
      .post('/api/v1/auth/login')
      .set('x-csrf-token', loginToken)
      .send({ email: 'ada@example.com', password: 'reset-secure-password' })
      .expect(200);
    expect(repository.auditEvents.some((event) => event.eventType === 'EMAIL_VERIFIED')).toBe(true);
    expect(
      repository.auditEvents.some((event) => event.eventType === 'PASSWORD_RESET_COMPLETED'),
    ).toBe(true);
    expect(repository.auditEvents.some((event) => event.eventType === 'ALL_SESSIONS_REVOKED')).toBe(
      true,
    );
  });

  it('returns 429 and Retry-After when an authentication limit is exhausted', async () => {
    const agent = request.agent(server);
    const csrfResponse = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrfResponse.body as { csrfToken: string }).csrfToken;
    rateLimitsAllowed = false;
    try {
      await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', csrfToken)
        .send({ email: 'ada@example.com', password: 'reset-secure-password' })
        .expect('Retry-After', '60')
        .expect(429);
    } finally {
      rateLimitsAllowed = true;
    }
  });
});
