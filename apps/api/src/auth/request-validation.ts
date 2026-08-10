import { BadRequestException } from '@nestjs/common';
import type { ZodType } from 'zod';

export const parseRequest = <T>(schema: ZodType<T>, input: unknown): T => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid request');
  }
  return parsed.data;
};
