import { describe, expect, it } from 'vitest';

import { storyViewerReducer, type StoryViewerState } from './story-viewer-reducer';

const open: StoryViewerState = { isOpen: true, authorIndex: 0, storyIndex: 0 };

describe('storyViewerReducer', () => {
  it('moves within an author and then to the next author before closing', () => {
    const secondStory = storyViewerReducer(open, { type: 'NEXT', storyCount: 2, authorCount: 2 });
    expect(secondStory).toEqual({ isOpen: true, authorIndex: 0, storyIndex: 1 });
    const nextAuthor = storyViewerReducer(secondStory, {
      type: 'NEXT',
      storyCount: 2,
      authorCount: 2,
    });
    expect(nextAuthor).toEqual({ isOpen: true, authorIndex: 1, storyIndex: 0 });
    expect(
      storyViewerReducer(nextAuthor, { type: 'NEXT', storyCount: 1, authorCount: 2 }).isOpen,
    ).toBe(false);
  });

  it('moves backward across author boundaries and closes explicitly', () => {
    const state = { isOpen: true, authorIndex: 1, storyIndex: 0 };
    expect(storyViewerReducer(state, { type: 'PREVIOUS', previousAuthorStoryCount: 3 })).toEqual({
      isOpen: true,
      authorIndex: 0,
      storyIndex: 2,
    });
    expect(storyViewerReducer(state, { type: 'CLOSE' }).isOpen).toBe(false);
  });

  it('recovers from an unavailable current Story by advancing', () => {
    expect(
      storyViewerReducer(open, { type: 'STORY_UNAVAILABLE', storyCount: 0, authorCount: 2 }),
    ).toEqual({
      isOpen: true,
      authorIndex: 1,
      storyIndex: 0,
    });
  });
});
