import type { InfiniteData } from '@tanstack/react-query';

import type { MessageResponse, MessagesResponse } from '@instaclone/api-contracts';

export type MessagesCache = InfiniteData<MessagesResponse, unknown>;

export const mergeMessage = (
  current: MessagesCache | undefined,
  message: MessageResponse,
): MessagesCache => {
  if (!current) {
    return {
      pages: [{ items: [message], nextCursor: null, hasMore: false }],
      pageParams: [undefined],
    };
  }
  const withoutDuplicate = current.pages.map((page) => ({
    ...page,
    items: page.items.filter(
      (item) => item.id !== message.id && item.clientMessageId !== message.clientMessageId,
    ),
  }));
  return {
    ...current,
    pages: withoutDuplicate.map((page, index) => ({
      ...page,
      items: index === 0 ? [message, ...page.items] : page.items,
    })),
  };
};

export const uniqueChronologicalMessages = (
  cache: MessagesCache | undefined,
): MessageResponse[] => {
  const byId = new Map<string, MessageResponse>();
  for (const page of cache?.pages ?? []) {
    for (const message of page.items) byId.set(message.id, message);
  }
  return [...byId.values()].sort((first, second) => first.sequence - second.sequence);
};
