import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MEDIA_UPLOADED_EVENT, type MediaUploadedEvent } from '@instaclone/api-contracts';

import { MediaProcessingRepository } from './media-processing.repository';

const enabled = process.env.RUN_POSTGRES_INTEGRATION === 'true';

describe.runIf(enabled)('MediaProcessingRepository PostgreSQL lease', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  });

  afterAll(async () => pool.end());

  it('allows one concurrent claimant, rejects stale completion, and reclaims an expired lease', async () => {
    const ownerId = randomUUID();
    const mediaId = randomUUID();
    const event: MediaUploadedEvent = {
      eventId: randomUUID(),
      eventName: MEDIA_UPLOADED_EVENT,
      eventVersion: 1,
      aggregateType: 'MediaAsset',
      aggregateId: mediaId,
      occurredAt: new Date().toISOString(),
      correlationId: 'lease-integration',
      payload: { mediaId, ownerId },
    };
    await pool.query(
      `INSERT INTO users (id, email, "updatedAt") VALUES ($1, $2, CURRENT_TIMESTAMP)`,
      [ownerId, `worker-lease-${ownerId}@example.com`],
    );
    await pool.query(
      `INSERT INTO media_assets
        (id, "ownerId", kind, "objectKey", "declaredMimeType", "declaredSizeBytes",
         "verifiedSizeBytes", status, "updatedAt")
       VALUES ($1, $2, 'IMAGE', $3, 'image/jpeg', 10, 10, 'UPLOADED', CURRENT_TIMESTAMP)`,
      [mediaId, ownerId, `lease/${mediaId}`],
    );
    try {
      const repository = new MediaProcessingRepository(pool);
      const [first, second] = await Promise.all([
        repository.claim(event, 'worker-one'),
        repository.claim(event, 'worker-two'),
      ]);
      expect([first, second].filter(Boolean)).toHaveLength(1);
      const winner = first ? 'worker-one' : 'worker-two';
      const loser = first ? 'worker-two' : 'worker-one';
      await expect(
        repository.complete(event.eventId, mediaId, loser, {
          width: 10,
          height: 10,
          thumbnailObjectKey: `lease/${mediaId}/thumb`,
        }),
      ).resolves.toBe(false);
      expect(
        (await pool.query(`SELECT status FROM media_assets WHERE id = $1`, [mediaId])).rows[0],
      ).toMatchObject({ status: 'PROCESSING' });

      await pool.query(
        `UPDATE media_assets SET "processingLeaseUntil" = CURRENT_TIMESTAMP - INTERVAL '1 second'
         WHERE id = $1`,
        [mediaId],
      );
      await expect(repository.claim(event, 'recovery-worker')).resolves.toMatchObject({
        id: mediaId,
      });
      await expect(
        repository.complete(event.eventId, mediaId, winner, {
          width: 10,
          height: 10,
          thumbnailObjectKey: `lease/${mediaId}/thumb`,
        }),
      ).resolves.toBe(false);
      await expect(
        repository.complete(event.eventId, mediaId, 'recovery-worker', {
          width: 10,
          height: 10,
          thumbnailObjectKey: `lease/${mediaId}/thumb`,
        }),
      ).resolves.toBe(true);
      expect(
        await pool.query(`SELECT status, "processingWorkerId" FROM media_assets WHERE id = $1`, [
          mediaId,
        ]),
      ).toMatchObject({ rows: [{ status: 'READY', processingWorkerId: null }] });
    } finally {
      await pool.query(`DELETE FROM consumer_event_receipts WHERE "eventId" = $1`, [event.eventId]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
    }
  });
});
