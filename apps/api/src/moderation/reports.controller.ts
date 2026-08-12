import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';

import { createReportInputSchema, type CreateReportResponse } from '@instaclone/api-contracts';

import { AccessAuthGuard } from '../auth/access-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { AuthRateLimitGuard, RequestRateLimit } from '../auth/auth-rate-limit.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { parseRequest } from '../auth/request-validation';
import { VerifiedEmailGuard } from '../auth/verified-email.guard';
import { ModerationService } from './moderation.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly moderation: ModerationService) {}

  @Post()
  @RequestRateLimit({ bucket: 'report-create', limit: 20, windowSeconds: 3_600 })
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard, AuthRateLimitGuard)
  report(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<CreateReportResponse> {
    return this.moderation.report(request.identity.id, parseRequest(createReportInputSchema, body));
  }
}
