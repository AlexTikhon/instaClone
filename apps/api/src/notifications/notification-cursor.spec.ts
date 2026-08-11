import { describe, expect, it } from 'vitest';

import { ApiError } from '../platform/errors/api-error';
import { decodeNotificationCursor, encodeNotificationCursor } from './notification-cursor';

describe('notification cursor', () => {
  it('round trips the stable createdAt/id boundary', () => {
    const cursor = { createdAt: new Date('2026-08-11T12:00:00.000Z'), id: crypto.randomUUID() };
    expect(decodeNotificationCursor(encodeNotificationCursor(cursor))).toEqual(cursor);
  });

  it('returns the notification-specific safe error for malformed input', () => {
    expect.assertions(3);
    try {
      decodeNotificationCursor('not-json');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.getStatus()).toBe(400);
      expect(apiError.getResponse()).toMatchObject({ code: 'INVALID_NOTIFICATION_CURSOR' });
    }
  });
});
