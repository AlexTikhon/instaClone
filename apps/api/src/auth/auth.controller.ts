import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  changePasswordInputSchema,
  forgotPasswordInputSchema,
  loginInputSchema,
  registerInputSchema,
  resetPasswordInputSchema,
  verifyEmailInputSchema,
  type AcceptedResponse,
  type AuthResponse,
  type AuthSessionsResponse,
  type CsrfResponse,
} from '@instaclone/api-contracts';

import type { SessionMetadata } from '../identity/identity.types';
import { AccessAuthGuard } from './access-auth.guard';
import { AuthRateLimit, AuthRateLimitGuard } from './auth-rate-limit.guard';
import { REFRESH_COOKIE } from './auth.constants';
import type { AuthenticatedRequest } from './authenticated-request';
import { AuthTokensService } from './auth-tokens.service';
import { AuthService, type SessionIssue } from './auth.service';
import { CsrfGuard } from './csrf.guard';
import { parseRequest } from './request-validation';

const readCookie = (request: Request, name: string): unknown => {
  const cookies: unknown = request.cookies;
  return typeof cookies === 'object' && cookies !== null
    ? (cookies as Record<string, unknown>)[name]
    : undefined;
};

const requestMetadata = (request: Request): SessionMetadata => ({
  ipAddress: request.ip?.slice(0, 45) ?? null,
  userAgent: request.get('user-agent')?.slice(0, 512) ?? null,
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: AuthTokensService,
  ) {}

  @Get('csrf')
  csrf(@Res({ passthrough: true }) response: Response): CsrfResponse {
    const csrfToken = this.tokens.createCsrfToken();
    this.tokens.setCsrfCookie(response, csrfToken);
    return { csrfToken };
  }

  @Post('register')
  @UseGuards(AuthRateLimitGuard, CsrfGuard)
  @AuthRateLimit({ bucket: 'register', limit: 5, windowSeconds: 3_600, includeEmail: true })
  async register(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.completeSession(
      response,
      await this.auth.register(parseRequest(registerInputSchema, body), requestMetadata(request)),
    );
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(AuthRateLimitGuard, CsrfGuard)
  @AuthRateLimit({ bucket: 'login', limit: 10, windowSeconds: 900, includeEmail: true })
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.completeSession(
      response,
      await this.auth.login(parseRequest(loginInputSchema, body), requestMetadata(request)),
    );
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(AuthRateLimitGuard, CsrfGuard)
  @AuthRateLimit({ bucket: 'refresh', limit: 60, windowSeconds: 900 })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const refreshToken = readCookie(request, REFRESH_COOKIE);
    return this.completeSession(
      response,
      await this.auth.refresh(
        typeof refreshToken === 'string' ? refreshToken : '',
        requestMetadata(request),
      ),
    );
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const refreshToken = readCookie(request, REFRESH_COOKIE);
    await this.auth.logout(
      typeof refreshToken === 'string' ? refreshToken : undefined,
      requestMetadata(request),
    );
    this.tokens.clearSessionCookies(response);
  }

  @Get('me')
  @UseGuards(AccessAuthGuard)
  me(@Req() request: AuthenticatedRequest): AuthResponse {
    return {
      user: {
        id: request.identity.id,
        email: request.identity.email,
        emailVerified: request.identity.emailVerified,
        profile: request.identity.profile,
      },
    };
  }

  @Post('email/verify')
  @HttpCode(204)
  @UseGuards(AuthRateLimitGuard, CsrfGuard)
  @AuthRateLimit({ bucket: 'email-verify', limit: 10, windowSeconds: 3_600 })
  async verifyEmail(@Body() body: unknown, @Req() request: Request): Promise<void> {
    const input = parseRequest(verifyEmailInputSchema, body);
    await this.auth.verifyEmail(input.token, requestMetadata(request));
  }

  @Post('email/resend')
  @HttpCode(202)
  @UseGuards(AccessAuthGuard, AuthRateLimitGuard, CsrfGuard)
  @AuthRateLimit({ bucket: 'email-resend', limit: 5, windowSeconds: 3_600 })
  async resendEmail(@Req() request: AuthenticatedRequest): Promise<AcceptedResponse> {
    await this.auth.resendEmailVerification(request.identity.id, requestMetadata(request));
    return { accepted: true };
  }

  @Post('password/forgot')
  @HttpCode(202)
  @UseGuards(AuthRateLimitGuard, CsrfGuard)
  @AuthRateLimit({ bucket: 'password-forgot', limit: 5, windowSeconds: 3_600, includeEmail: true })
  async forgotPassword(@Body() body: unknown, @Req() request: Request): Promise<AcceptedResponse> {
    const input = parseRequest(forgotPasswordInputSchema, body);
    await this.auth.forgotPassword(input.email, requestMetadata(request));
    return { accepted: true };
  }

  @Post('password/reset')
  @HttpCode(204)
  @UseGuards(AuthRateLimitGuard, CsrfGuard)
  @AuthRateLimit({ bucket: 'password-reset', limit: 5, windowSeconds: 3_600 })
  async resetPassword(@Body() body: unknown, @Req() request: Request): Promise<void> {
    await this.auth.resetPassword(
      parseRequest(resetPasswordInputSchema, body),
      requestMetadata(request),
    );
  }

  @Post('password/change')
  @HttpCode(204)
  @UseGuards(AccessAuthGuard, CsrfGuard)
  async changePassword(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.changePassword(
      request.identity.id,
      request.identity.sessionId,
      parseRequest(changePasswordInputSchema, body),
      requestMetadata(request),
    );
    this.tokens.clearSessionCookies(response);
  }

  @Get('sessions')
  @UseGuards(AccessAuthGuard)
  async sessions(@Req() request: AuthenticatedRequest): Promise<AuthSessionsResponse> {
    const sessions = await this.auth.listSessions(request.identity.id);
    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        current: session.id === request.identity.sessionId,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      })),
    };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @UseGuards(AccessAuthGuard, CsrfGuard)
  async revokeSession(
    @Param('sessionId') sessionId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.revokeSession(request.identity.id, sessionId, requestMetadata(request));
    if (sessionId === request.identity.sessionId) this.tokens.clearSessionCookies(response);
  }

  @Delete('sessions')
  @HttpCode(204)
  @UseGuards(AccessAuthGuard, CsrfGuard)
  async revokeAllSessions(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.revokeAllSessions(request.identity.id, requestMetadata(request));
    this.tokens.clearSessionCookies(response);
  }

  private completeSession(response: Response, issue: SessionIssue): AuthResponse {
    this.tokens.setSessionCookies(response, issue.user.id, issue.sessionId, issue.refreshToken);
    return { user: issue.user };
  }
}
