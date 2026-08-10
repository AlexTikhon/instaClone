import { randomUUID } from 'node:crypto';

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';

const REQUEST_ID_HEADER = 'x-request-id';
const MAX_REQUEST_ID_LENGTH = 128;

const inboundRequestId = (request: IncomingMessage): string | undefined => {
  const value = request.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(value) ? value[0] : value;

  if (!candidate || candidate.length > MAX_REQUEST_ID_LENGTH || !/^[\w./:-]+$/.test(candidate)) {
    return undefined;
  }

  return candidate;
};

export const createHttpLoggerOptions = (
  nodeEnvironment: 'development' | 'test' | 'production',
  logLevel: string,
): Params => ({
  pinoHttp: {
    autoLogging: nodeEnvironment !== 'test',
    customProps: () => ({ service: 'api' }),
    genReqId: (request: IncomingMessage, response: ServerResponse) => {
      const requestId = inboundRequestId(request) ?? randomUUID();
      response.setHeader(REQUEST_ID_HEADER, requestId);
      return requestId;
    },
    level: logLevel,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
        '*.password',
        '*.token',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
    transport:
      nodeEnvironment === 'development'
        ? {
            target: 'pino-pretty',
            options: { colorize: true, singleLine: true, translateTime: 'SYS:standard' },
          }
        : undefined,
  },
});
