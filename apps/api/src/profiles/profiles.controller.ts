import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';

import { updateProfileInputSchema, type Profile } from '@instaclone/api-contracts';

import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { parseRequest } from '../auth/request-validation';
import { ProfilesService } from './profiles.service';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Patch('me')
  @UseGuards(AccessAuthGuard, CsrfGuard)
  async updateOwn(@Req() request: AuthenticatedRequest, @Body() body: unknown): Promise<Profile> {
    return this.profiles.updateOwn(
      request.identity.id,
      parseRequest(updateProfileInputSchema, body),
    );
  }

  @Get(':username')
  findPublic(@Param('username') username: string): Promise<Profile> {
    return this.profiles.findPublic(username);
  }
}
