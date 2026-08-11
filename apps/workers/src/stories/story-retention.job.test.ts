import { describe, expect, it, vi } from 'vitest';

import { STORY_RETENTION_DAYS, StoryRetentionJob } from './story-retention.job';

describe('StoryRetentionJob', () => {
  it('hard-deletes only Stories beyond the post-expiration retention window', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 4 });
    const job = new StoryRetentionJob({ query } as never);
    const now = new Date('2026-08-11T12:00:00.000Z');
    await expect(job.run(now)).resolves.toBe(4);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('"expiresAt" <= $1'), [
      new Date(now.getTime() - STORY_RETENTION_DAYS * 24 * 60 * 60 * 1_000),
    ]);
  });
});
