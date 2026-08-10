import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { LivenessResponse, ReadinessResponse } from '@instaclone/api-contracts';

import { HealthService } from './health.service';

@ApiTags('platform')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOkResponse({ description: 'The API process is serving requests.' })
  liveness(): LivenessResponse {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOkResponse({ description: 'All required infrastructure dependencies are reachable.' })
  @ApiServiceUnavailableResponse({
    description: 'One or more required dependencies are unavailable.',
  })
  async readiness(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    const health = await this.health.readiness();
    if (health.status === 'not_ready') response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return health;
  }
}
