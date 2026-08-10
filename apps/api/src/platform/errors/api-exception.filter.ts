import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import type { ErrorEnvelope } from '@instaclone/api-contracts';

type RequestWithId = Request & { id?: string };

const statusCodeName = (status: number): string => {
  const knownCodes: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'ROUTE_NOT_FOUND',
    [HttpStatus.CONFLICT]: 'CONFLICT',
    [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
    [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
  };

  return knownCodes[status] ?? 'INTERNAL_SERVER_ERROR';
};

const exceptionMessage = (exception: unknown, status: number): string => {
  if (status >= 500) {
    return status === 503 ? 'Service is temporarily unavailable' : 'An unexpected error occurred';
  }

  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response !== null && 'message' in response) {
      const message = response.message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
        return message.join('; ');
      }
    }
  }

  return 'Request could not be completed';
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const body: ErrorEnvelope = {
      error: {
        code: statusCodeName(status),
        message: exceptionMessage(exception, status),
        requestId: request.id ?? 'unknown',
      },
    };

    response.status(status).json(body);
  }
}
