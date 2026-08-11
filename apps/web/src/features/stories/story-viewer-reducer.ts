export interface StoryViewerState {
  isOpen: boolean;
  authorIndex: number;
  storyIndex: number;
}

export type StoryViewerEvent =
  | { type: 'OPEN'; authorIndex: number; storyIndex: number }
  | { type: 'NEXT'; storyCount: number; authorCount: number }
  | { type: 'PREVIOUS'; previousAuthorStoryCount: number }
  | { type: 'STORY_UNAVAILABLE'; storyCount: number; authorCount: number }
  | { type: 'CLOSE' };

export const closedStoryViewerState: StoryViewerState = {
  isOpen: false,
  authorIndex: 0,
  storyIndex: 0,
};

const advance = (
  state: StoryViewerState,
  storyCount: number,
  authorCount: number,
): StoryViewerState => {
  if (state.storyIndex + 1 < storyCount) return { ...state, storyIndex: state.storyIndex + 1 };
  if (state.authorIndex + 1 < authorCount) {
    return { isOpen: true, authorIndex: state.authorIndex + 1, storyIndex: 0 };
  }
  return closedStoryViewerState;
};

export const storyViewerReducer = (
  state: StoryViewerState,
  event: StoryViewerEvent,
): StoryViewerState => {
  switch (event.type) {
    case 'OPEN':
      return { isOpen: true, authorIndex: event.authorIndex, storyIndex: event.storyIndex };
    case 'NEXT':
    case 'STORY_UNAVAILABLE':
      return advance(state, event.storyCount, event.authorCount);
    case 'PREVIOUS':
      if (state.storyIndex > 0) return { ...state, storyIndex: state.storyIndex - 1 };
      if (state.authorIndex === 0) return state;
      return {
        isOpen: true,
        authorIndex: state.authorIndex - 1,
        storyIndex: Math.max(0, event.previousAuthorStoryCount - 1),
      };
    case 'CLOSE':
      return closedStoryViewerState;
  }
};
