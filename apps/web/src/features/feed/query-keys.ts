export const queryKeys = {
  feed: ['feed'] as const,
  comments: (postId: string) => ['comments', postId] as const,
  post: (postId: string) => ['post', postId] as const,
  notifications: ['notifications'] as const,
  stories: ['stories'] as const,
  storySequence: (authorId: string) => ['stories', 'user', authorId] as const,
  storyViewers: (storyId: string) => ['story-viewers', storyId] as const,
  searchUsers: (normalizedQuery: string) => ['search', 'users', normalizedQuery] as const,
  searchUsersRoot: ['search', 'users'] as const,
  explore: ['explore'] as const,
  profile: (username: string) => ['profile', username] as const,
  profilePosts: (userId: string) => ['profile-posts', userId] as const,
};
