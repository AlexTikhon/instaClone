import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { authResponseSchema, profileSchema } from '@instaclone/api-contracts';

import { AppModule } from '../src/app.module';
import {
  IDENTITY_REPOSITORY,
  IdentityConflictError,
  type IdentityRepository,
} from '../src/identity/identity.repository';
import type {
  CreateIdentityInput,
  IdentityRecord,
  RotationResult,
  SessionRecord,
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

class InMemoryIdentityRepository implements IdentityRepository {
  readonly identities = new Map<string, IdentityRecord>();
  readonly sessions = new Map<string, StoredSession>();
  readonly refreshTokens = new Map<string, StoredToken>();

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
  ): Promise<void> {
    const identity = this.identities.get(userId);
    if (!identity) throw new Error('Missing identity');
    this.sessions.set(sessionId, {
      id: sessionId,
      userId,
      expiresAt,
      revokedAt: null,
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_REPOSITORY)
      .useValue(new InMemoryIdentityRepository())
      .overrideProvider(PrismaService)
      .useValue({ ping: () => Promise.resolve() })
      .overrideProvider(RedisService)
      .useValue({ ping: () => Promise.resolve() })
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
});
