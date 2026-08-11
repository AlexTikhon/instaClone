import type { Pool } from 'pg';

export const STORY_RETENTION_DAYS = 30;

export class StoryRetentionJob {
  constructor(private readonly database: Pick<Pool, 'query'>) {}

  async run(now = new Date()): Promise<number> {
    const retainAfter = new Date(now.getTime() - STORY_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
    const result = await this.database.query(
      `DELETE FROM stories
       WHERE "expiresAt" <= $1`,
      [retainAfter],
    );
    return result.rowCount ?? 0;
  }
}
