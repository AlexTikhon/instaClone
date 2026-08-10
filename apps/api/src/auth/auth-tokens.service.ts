import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';

import type { ApiEnvironment } from '@instaclone/config';

import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from './auth.constants';

interface AccessClaims {
  userId: string;
  sessionId: string;
}

@Injectable()
export class AuthTokensService {
  private readonly accessSecret: string;
  private readonly pepper: string;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;
  private readonly emailVerificationTtlSeconds: number;
  private readonly passwordResetTtlSeconds: number;
  private readonly secureCookies: boolean;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    this.accessSecret = config.get('AUTH_ACCESS_TOKEN_SECRET', { infer: true });
    this.pepper = config.get('AUTH_REFRESH_TOKEN_PEPPER', { infer: true });
    this.accessTtlSeconds = config.get('AUTH_ACCESS_TTL_SECONDS', { infer: true });
    this.refreshTtlSeconds = config.get('AUTH_REFRESH_TTL_SECONDS', { infer: true });
    this.emailVerificationTtlSeconds = config.get('AUTH_EMAIL_VERIFICATION_TTL_SECONDS', {
      infer: true,
    });
    this.passwordResetTtlSeconds = config.get('AUTH_PASSWORD_RESET_TTL_SECONDS', { infer: true });
    this.secureCookies = config.get('AUTH_COOKIE_SECURE', { infer: true });
  }

  get refreshLifetimeMs(): number {
    return this.refreshTtlSeconds * 1_000;
  }

  get emailVerificationLifetimeMs(): number {
    return this.emailVerificationTtlSeconds * 1_000;
  }

  get passwordResetLifetimeMs(): number {
    return this.passwordResetTtlSeconds * 1_000;
  }

  createActionToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashActionToken(purpose: 'email-verification' | 'password-reset', token: string): string {
    return createHmac('sha256', this.pepper).update(`${purpose}:${token}`).digest('hex');
  }

  createAccessToken(userId: string, sessionId: string): string {
    return jwt.sign({ typ: 'access', sid: sessionId }, this.accessSecret, {
      algorithm: 'HS256',
      audience: 'instaclone-web',
      expiresIn: this.accessTtlSeconds,
      issuer: 'instaclone-api',
      jwtid: randomUUID(),
      subject: userId,
    });
  }

  verifyAccessToken(token: string): AccessClaims | null {
    try {
      const claims = jwt.verify(token, this.accessSecret, {
        algorithms: ['HS256'],
        audience: 'instaclone-web',
        issuer: 'instaclone-api',
      });
      if (
        typeof claims === 'string' ||
        claims.typ !== 'access' ||
        typeof claims.sub !== 'string' ||
        typeof claims.sid !== 'string'
      ) {
        return null;
      }
      return { userId: claims.sub, sessionId: claims.sid };
    } catch {
      return null;
    }
  }

  createRefreshToken(sessionId: string): string {
    return `${sessionId}.${randomBytes(32).toString('base64url')}`;
  }

  readRefreshSessionId(token: string): string | null {
    const [sessionId, secret, extra] = token.split('.');
    if (extra || !sessionId || !secret || !/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
    return sessionId;
  }

  hashRefreshToken(token: string): string {
    return createHmac('sha256', this.pepper).update(`refresh:${token}`).digest('hex');
  }

  createCsrfToken(): string {
    const nonce = randomBytes(24).toString('base64url');
    return `${nonce}.${this.signCsrfNonce(nonce)}`;
  }

  isValidCsrfPair(cookieToken: unknown, headerToken: unknown): boolean {
    if (typeof cookieToken !== 'string' || typeof headerToken !== 'string') return false;
    const cookieDigest = createHash('sha256').update(cookieToken).digest();
    const headerDigest = createHash('sha256').update(headerToken).digest();
    if (!timingSafeEqual(cookieDigest, headerDigest)) return false;
    const [nonce, signature, extra] = cookieToken.split('.');
    if (extra || !nonce || !signature) return false;
    const expected = Buffer.from(this.signCsrfNonce(nonce));
    const actual = Buffer.from(signature);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  setCsrfCookie(response: Response, token: string): void {
    response.cookie(CSRF_COOKIE, token, {
      ...this.baseCookieOptions,
      httpOnly: false,
      maxAge: this.refreshLifetimeMs,
      path: '/',
    });
  }

  setSessionCookies(
    response: Response,
    userId: string,
    sessionId: string,
    refreshToken: string,
  ): void {
    response.cookie(ACCESS_COOKIE, this.createAccessToken(userId, sessionId), {
      ...this.baseCookieOptions,
      httpOnly: true,
      maxAge: this.accessTtlSeconds * 1_000,
      path: '/',
    });
    response.cookie(REFRESH_COOKIE, refreshToken, {
      ...this.baseCookieOptions,
      httpOnly: true,
      maxAge: this.refreshLifetimeMs,
      path: '/api/v1/auth',
    });
  }

  clearSessionCookies(response: Response): void {
    response.clearCookie(ACCESS_COOKIE, { ...this.baseCookieOptions, httpOnly: true, path: '/' });
    response.clearCookie(REFRESH_COOKIE, {
      ...this.baseCookieOptions,
      httpOnly: true,
      path: '/api/v1/auth',
    });
  }

  private signCsrfNonce(nonce: string): string {
    return createHmac('sha256', this.pepper).update(`csrf:${nonce}`).digest('base64url');
  }

  private get baseCookieOptions(): CookieOptions {
    return { secure: this.secureCookies, sameSite: 'strict' };
  }
}
