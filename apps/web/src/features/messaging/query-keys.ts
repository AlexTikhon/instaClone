export const messagingKeys = {
  all: ['messaging'] as const,
  conversations: () => ['messaging', 'conversations'] as const,
  conversation: (conversationId: string) => ['messaging', 'conversation', conversationId] as const,
  messages: (conversationId: string) => ['messaging', 'messages', conversationId] as const,
};
