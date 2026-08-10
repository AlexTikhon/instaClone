import {
  CanActivate,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';

import { RedisService } from '../infrastructure/redis/redis.service';

interface RateLimitPolicy {
  bucket: string;
  limit: number;
  windowSeconds: number;
  includeEmail?: boolean;
}

const RATE_LIMIT_POLICY = 'auth-rate-limit-policy';

export const AuthRateLimit = (policy: RateLimitPolicy): MethodDecorator =>
  SetMetadata(RATE_LIMIT_POLICY, policy);

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.get<RateLimitPolicy>(RATE_LIMIT_POLICY, context.getHandler());
    if (!policy) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const email = this.readEmail(request, policy.includeEmail === true);
    const subject = createHash('sha256')
      .update(`${request.ip ?? 'unknown'}:${email}`)
      .digest('hex');
    const remainingWindow = await this.redis.consumeRateLimit(
      `auth-rate:${policy.bucket}:${subject}`,
      policy.limit,
      policy.windowSeconds,
    );
    if (remainingWindow < 0) {
      response.setHeader('Retry-After', String(Math.abs(remainingWindow)));
      throw new HttpException('Too many authentication attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private readEmail(request: Request, includeEmail: boolean): string {
    if (!includeEmail || typeof request.body !== 'object' || request.body === null) return '';
    const email = (request.body as Record<string, unknown>).email;
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
  }
}
