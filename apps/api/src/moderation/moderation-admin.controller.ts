import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  moderationCaseIdSchema,
  moderationCasesQuerySchema,
  resolveModerationCaseInputSchema,
  type ModerationCaseDetail,
  type ModerationCasesResponse,
} from '@instaclone/api-contracts';

import { AccessAuthGuard } from '../auth/access-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { CsrfGuard } from '../auth/csrf.guard';
import { parseRequest } from '../auth/request-validation';
import { VerifiedEmailGuard } from '../auth/verified-email.guard';
import { ModerationService } from './moderation.service';
import { ModeratorGuard } from './moderator.guard';

@Controller('moderation/cases')
export class ModerationAdminController {
  constructor(private readonly moderation: ModerationService) {}

  @Get()
  @UseGuards(AccessAuthGuard, ModeratorGuard)
  list(@Query() query: unknown): Promise<ModerationCasesResponse> {
    return this.moderation.listCases(parseRequest(moderationCasesQuerySchema, query));
  }

  @Get(':caseId')
  @UseGuards(AccessAuthGuard, ModeratorGuard)
  find(@Param('caseId') caseId: string): Promise<ModerationCaseDetail> {
    return this.moderation.findCase(parseRequest(moderationCaseIdSchema, caseId));
  }

  @Post(':caseId/start-review')
  @HttpCode(200)
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, ModeratorGuard, CsrfGuard)
  startReview(
    @Req() request: AuthenticatedRequest,
    @Param('caseId') caseId: string,
  ): Promise<ModerationCaseDetail> {
    return this.moderation.startReview(parseRequest(moderationCaseIdSchema, caseId), {
      id: request.identity.id,
      role: this.role(request),
    });
  }

  @Post(':caseId/resolve')
  @HttpCode(200)
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, ModeratorGuard, CsrfGuard)
  resolve(
    @Req() request: AuthenticatedRequest,
    @Param('caseId') caseId: string,
    @Body() body: unknown,
  ): Promise<ModerationCaseDetail> {
    return this.moderation.resolve(
      parseRequest(moderationCaseIdSchema, caseId),
      { id: request.identity.id, role: this.role(request) },
      parseRequest(resolveModerationCaseInputSchema, body),
      request.id,
    );
  }

  private role(request: AuthenticatedRequest): 'MODERATOR' | 'ADMIN' {
    return request.identity.role === 'ADMIN' ? 'ADMIN' : 'MODERATOR';
  }
}
