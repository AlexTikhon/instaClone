import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';

import {
  createReelInputSchema,
  reelIdSchema,
  reelsQuerySchema,
  type ReelResponse,
  type ReelsResponse,
} from '@instaclone/api-contracts';

import { AccessAuthGuard } from '../auth/access-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { CsrfGuard } from '../auth/csrf.guard';
import { parseRequest } from '../auth/request-validation';
import { VerifiedEmailGuard } from '../auth/verified-email.guard';
import { MediaService } from '../media/media.service';
import { ReelsService } from './reels.service';

@Controller('reels')
export class ReelsController {
  constructor(
    private readonly reels: ReelsService,
    private readonly media: MediaService,
  ) {}

  @Post()
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown): Promise<ReelResponse> {
    return this.reels.create(request.identity.id, parseRequest(createReelInputSchema, body));
  }

  @Get()
  @UseGuards(AccessAuthGuard)
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown): Promise<ReelsResponse> {
    return this.reels.list(request.identity.id, parseRequest(reelsQuerySchema, query));
  }

  @Get(':reelId/playback/master.m3u8')
  @Header('Cache-Control', 'private, max-age=30')
  @UseGuards(AccessAuthGuard)
  async master(
    @Req() request: AuthenticatedRequest,
    @Param('reelId') reelId: string,
  ): Promise<StreamableFile> {
    return this.delivery(request.identity.id, reelId, 'master.m3u8');
  }

  @Get(':reelId/playback/:rendition/:file')
  @Header('Cache-Control', 'private, max-age=30')
  @UseGuards(AccessAuthGuard)
  async rendition(
    @Req() request: AuthenticatedRequest,
    @Param('reelId') reelId: string,
    @Param('rendition') rendition: string,
    @Param('file') file: string,
  ): Promise<StreamableFile> {
    return this.delivery(request.identity.id, reelId, `${rendition}/${file}`);
  }

  @Get(':reelId/poster.webp')
  @Header('Cache-Control', 'private, max-age=60')
  @UseGuards(AccessAuthGuard)
  async poster(
    @Req() request: AuthenticatedRequest,
    @Param('reelId') reelId: string,
  ): Promise<StreamableFile> {
    return this.delivery(request.identity.id, reelId, 'poster.webp');
  }

  @Get(':reelId')
  @UseGuards(AccessAuthGuard)
  get(
    @Req() request: AuthenticatedRequest,
    @Param('reelId') reelId: string,
  ): Promise<ReelResponse> {
    return this.reels.get(request.identity.id, parseRequest(reelIdSchema, reelId));
  }

  @Delete(':reelId')
  @HttpCode(204)
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  delete(@Req() request: AuthenticatedRequest, @Param('reelId') reelId: string): Promise<void> {
    return this.reels.delete(request.identity.id, parseRequest(reelIdSchema, reelId));
  }

  private async delivery(
    viewerId: string,
    reelIdInput: string,
    relativePath: string,
  ): Promise<StreamableFile> {
    const reelId = parseRequest(reelIdSchema, reelIdInput);
    const mediaId = await this.reels.requirePlayback(viewerId, reelId);
    const object = await this.media.getVideoDeliveryObject(mediaId, relativePath);
    return new StreamableFile(object.body, {
      type: object.contentType ?? undefined,
      length: object.contentLength ?? undefined,
      disposition: 'inline',
    });
  }
}
