import { describe, expect, it } from 'vitest';

import type { StoryAuthorGroup } from '@instaclone/api-contracts';

import {
  compareStoryAuthorGroups,
  compareStoryPlayback,
  hasUnseenStories,
  isStoryActive,
} from './story-policy';

const group = (id: string, hasUnseenStories: boolean, latestStoryAt: string): StoryAuthorGroup => ({
  author: { id, username: id, displayName: id },
  isViewer: false,
  hasUnseenStories,
  storyCount: 1,
  latestStoryAt,
});

describe('Story policy', () => {
  it('uses an exclusive expiration boundary and excludes deleted Stories', () => {
    const now = new Date('2026-08-11T12:00:00.000Z');
    expect(isStoryActive({ deletedAt: null, expiresAt: new Date(now.getTime() + 1) }, now)).toBe(
      true,
    );
    expect(isStoryActive({ deletedAt: null, expiresAt: now }, now)).toBe(false);
    expect(
      isStoryActive({ deletedAt: new Date(), expiresAt: new Date(now.getTime() + 1) }, now),
    ).toBe(false);
  });

  it('orders unseen authors first and then by most recent activity', () => {
    const groups = [
      group('00000000-0000-4000-8000-000000000001', false, '2026-08-11T12:00:00.000Z'),
      group('00000000-0000-4000-8000-000000000002', true, '2026-08-11T10:00:00.000Z'),
      group('00000000-0000-4000-8000-000000000003', true, '2026-08-11T11:00:00.000Z'),
    ];
    expect(groups.sort(compareStoryAuthorGroups).map((item) => item.author.id)).toEqual([
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001',
    ]);
  });

  it('derives unseen state from any missing durable view except for the viewer author', () => {
    expect(hasUnseenStories(false, [true, false])).toBe(true);
    expect(hasUnseenStories(false, [true, true])).toBe(false);
    expect(hasUnseenStories(true, [false])).toBe(false);
  });

  it('orders playback oldest-first with an immutable id tie-breaker', () => {
    const createdAt = new Date('2026-08-11T12:00:00.000Z');
    const stories = [
      { id: 'b', createdAt: new Date(createdAt.getTime() + 1) },
      { id: 'c', createdAt },
      { id: 'a', createdAt },
    ];
    expect(stories.sort(compareStoryPlayback).map((story) => story.id)).toEqual(['a', 'c', 'b']);
  });
});
