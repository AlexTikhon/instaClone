import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  loginInputSchema,
  registerInputSchema,
  type AuthResponse,
  type CsrfResponse,
} from '@instaclone/api-contracts';

import { REFRESH_COOKIE } from './auth.constants';
import type { AuthenticatedRequest } from './authenticated-request';
import { AccessAuthGuard } from './access-auth.guard';
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
  @UseGuards(CsrfGuard)
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.completeSession(
      response,
      await this.auth.register(parseRequest(registerInputSchema, body)),
    );
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.completeSession(
      response,
      await this.auth.login(parseRequest(loginInputSchema, body)),
    );
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const refreshToken = readCookie(request, REFRESH_COOKIE);
    return this.completeSession(
      response,
      await this.auth.refresh(typeof refreshToken === 'string' ? refreshToken : ''),
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
    await this.auth.logout(typeof refreshToken === 'string' ? refreshToken : undefined);
    this.tokens.clearSessionCookies(response);
  }

  @Get('me')
  @UseGuards(AccessAuthGuard)
  me(@Req() request: AuthenticatedRequest): AuthResponse {
    return {
      user: {
        id: request.identity.id,
        email: request.identity.email,
        profile: request.identity.profile,
      },
    };
  }

  private completeSession(response: Response, issue: SessionIssue): AuthResponse {
    this.tokens.setSessionCookies(response, issue.user.id, issue.sessionId, issue.refreshToken);
    return { user: issue.user };
  }
}
