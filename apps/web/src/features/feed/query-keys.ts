export const queryKeys = {
  feed: ['feed'] as const,
  comments: (postId: string) => ['comments', postId] as const,
  post: (postId: string) => ['post', postId] as const,
  notifications: ['notifications'] as const,
  stories: ['stories'] as const,
  storySequence: (authorId: string) => ['stories', 'user', authorId] as const,
  storyViewers: (storyId: string) => ['story-viewers', storyId] as const,
};
