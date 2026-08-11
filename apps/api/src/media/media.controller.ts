import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';

import {
  finalizeMediaUploadInputSchema,
  initializeMediaUploadInputSchema,
  postIdSchema,
  type MediaResponse,
  type UploadInitializationResponse,
} from '@instaclone/api-contracts';

import { AccessAuthGuard } from '../auth/access-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { CsrfGuard } from '../auth/csrf.guard';
import { parseRequest } from '../auth/request-validation';
import { VerifiedEmailGuard } from '../auth/verified-email.guard';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('uploads')
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  initialize(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<UploadInitializationResponse> {
    return this.media.initialize(
      request.identity.id,
      parseRequest(initializeMediaUploadInputSchema, body),
    );
  }

  @Post(':mediaId/finalize')
  @HttpCode(200)
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  finalize(
    @Req() request: AuthenticatedRequest,
    @Param('mediaId') mediaId: string,
    @Body() body: unknown,
  ): Promise<MediaResponse> {
    parseRequest(finalizeMediaUploadInputSchema, body ?? {});
    return this.media.finalize(
      request.identity.id,
      parseRequest(postIdSchema, mediaId),
      request.id,
    );
  }

  @Get(':mediaId')
  @UseGuards(AccessAuthGuard)
  getOwn(
    @Req() request: AuthenticatedRequest,
    @Param('mediaId') mediaId: string,
  ): Promise<MediaResponse> {
    return this.media.getOwn(request.identity.id, parseRequest(postIdSchema, mediaId));
  }
}
