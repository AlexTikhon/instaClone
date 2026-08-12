import type { ConversationSummary, MessageResponse } from '@instaclone/api-contracts';

export interface ConversationPage {
  items: ConversationSummary[];
  hasMore: boolean;
  next: { snapshotAt: Date; activityAt: Date; conversationId: string } | null;
}

export interface MessagePage {
  items: MessageResponse[];
  hasMore: boolean;
  nextSequence: bigint | null;
}

export type CreateConversationResult =
  | { kind: 'created'; conversation: ConversationSummary }
  | { kind: 'self' | 'unavailable' | 'blocked' };

export type SendMessageResult =
  | { kind: 'sent' | 'existing'; message: MessageResponse }
  | { kind: 'not_found' | 'blocked' | 'unavailable' | 'idempotency_conflict' };

export interface ReadConversationResult {
  lastReadSequence: number;
  unreadCount: number;
}
