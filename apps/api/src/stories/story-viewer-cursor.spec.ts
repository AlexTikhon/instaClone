import { describe, expect, it } from 'vitest';

import { ApiError } from '../platform/errors/api-error';
import { decodeStoryViewerCursor, encodeStoryViewerCursor } from './story-viewer-cursor';

describe('Story viewer cursor', () => {
  it('round trips viewedAt and viewerId', () => {
    const cursor = {
      viewedAt: new Date('2026-08-11T12:00:00.000Z'),
      viewerId: '00000000-0000-4000-8000-000000000001',
    };
    expect(decodeStoryViewerCursor(encodeStoryViewerCursor(cursor))).toEqual(cursor);
  });

  it('rejects malformed cursors with a stable error code', () => {
    expect.assertions(2);
    try {
      decodeStoryViewerCursor('malformed');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).getResponse()).toMatchObject({ code: 'INVALID_STORY_CURSOR' });
    }
  });
});
