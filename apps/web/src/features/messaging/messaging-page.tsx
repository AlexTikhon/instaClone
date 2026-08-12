'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import type { ConversationSummary } from '@instaclone/api-contracts';

import { useAuth } from '../auth/auth-provider';
import { uniqueChronologicalMessages } from './messaging-cache';
import {
  useConversation,
  useConversations,
  useMarkConversationRead,
  useMessages,
  useSendMessage,
} from './use-messaging';

interface PendingMessage {
  clientMessageId: string;
  text: string;
  state: 'sending' | 'failed';
}

const uniqueConversations = (items: ConversationSummary[]): ConversationSummary[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

export function MessagingPage({ conversationId }: { conversationId?: string }) {
  const conversations = useConversations();
  const items = uniqueConversations(conversations.data?.pages.flatMap((page) => page.items) ?? []);
  return (
    <section className={`messagingLayout ${conversationId ? 'hasActiveThread' : ''}`}>
      <aside className="conversationPane" aria-label="Conversations">
        <header>
          <p className="eyebrow">Inbox</p>
          <h1>Messages</h1>
        </header>
        {conversations.isPending ? (
          <div className="messageState">Loading conversations&hellip;</div>
        ) : conversations.isError ? (
          <div className="messageState" role="alert">
            Conversations could not be loaded.
          </div>
        ) : items.length === 0 ? (
          <div className="messageState">
            No conversations yet. Open a profile and choose Message.
          </div>
        ) : (
          <ul className="conversationList">
            {items.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  className={conversation.id === conversationId ? 'active' : undefined}
                  href={`/messages/${conversation.id}`}
                >
                  <span className="profileAvatar" aria-hidden="true">
                    {conversation.peer.displayName.slice(0, 1).toLocaleUpperCase('en-US')}
                  </span>
                  <span>
                    <strong>{conversation.peer.displayName}</strong>
                    <small>{conversation.lastMessage?.text ?? 'Start the conversation'}</small>
                  </span>
                  {conversation.unreadCount > 0 ? (
                    <span className="unreadBadge" aria-label={`${conversation.unreadCount} unread`}>
                      {conversation.unreadCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {conversations.hasNextPage ? (
          <button
            className="loadMore"
            type="button"
            disabled={conversations.isFetchingNextPage}
            onClick={() => void conversations.fetchNextPage()}
          >
            {conversations.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        ) : null}
      </aside>
      <div className="threadPane">
        {conversationId ? (
          <MessageThread key={conversationId} conversationId={conversationId} />
        ) : (
          <div className="threadEmpty">
            <h2>Your messages</h2>
            <p>Select a conversation or start one from a profile.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function MessageThread({ conversationId }: { conversationId: string }) {
  const { user } = useAuth();
  const conversation = useConversation(conversationId);
  const messagesQuery = useMessages(conversationId);
  const send = useSendMessage(conversationId);
  const read = useMarkConversationRead(conversationId);
  const markRead = read.mutate;
  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const initializedRef = useRef(false);
  const lastMarkedRef = useRef<string | null>(null);
  const messages = useMemo(
    () => uniqueChronologicalMessages(messagesQuery.data),
    [messagesQuery.data],
  );
  const latestIncoming = [...messages].reverse().find((message) => message.senderId !== user?.id);
  const latestSequence = messages.at(-1)?.sequence;

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || messagesQuery.isPending || initializedRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
    initializedRef.current = true;
  }, [messagesQuery.isPending, messages.length]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (viewport && initializedRef.current && nearBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [latestSequence, pending.length]);

  useEffect(() => {
    if (!latestIncoming || !nearBottomRef.current || lastMarkedRef.current === latestIncoming.id) {
      return;
    }
    const timer = window.setTimeout(() => {
      lastMarkedRef.current = latestIncoming.id;
      markRead(latestIncoming.id);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [latestIncoming, markRead]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text;
    if (!value.trim() || value.length > 4_000) return;
    const clientMessageId = crypto.randomUUID();
    setPending((current) => [...current, { clientMessageId, text: value, state: 'sending' }]);
    setText('');
    attemptSend(clientMessageId, value);
  };

  const attemptSend = (clientMessageId: string, value: string) => {
    setPending((current) =>
      current.map((item) =>
        item.clientMessageId === clientMessageId ? { ...item, state: 'sending' } : item,
      ),
    );
    send.mutate(
      { clientMessageId, text: value },
      {
        onSuccess: () =>
          setPending((current) =>
            current.filter((item) => item.clientMessageId !== clientMessageId),
          ),
        onError: () =>
          setPending((current) =>
            current.map((item) =>
              item.clientMessageId === clientMessageId ? { ...item, state: 'failed' } : item,
            ),
          ),
      },
    );
  };

  const loadOlder = async () => {
    const viewport = scrollRef.current;
    const previousHeight = viewport?.scrollHeight ?? 0;
    const previousTop = viewport?.scrollTop ?? 0;
    await messagesQuery.fetchNextPage();
    window.requestAnimationFrame(() => {
      if (viewport) viewport.scrollTop = previousTop + viewport.scrollHeight - previousHeight;
    });
  };

  if (conversation.isPending)
    return <div className="threadEmpty">Loading conversation&hellip;</div>;
  if (conversation.isError) {
    return (
      <div className="threadEmpty" role="alert">
        This conversation is unavailable.
      </div>
    );
  }

  return (
    <div className="messageThread">
      <header className="threadHeader">
        <Link className="mobileBack" href="/messages" aria-label="Back to conversations">
          ←
        </Link>
        <span className="profileAvatar" aria-hidden="true">
          {conversation.data.peer.displayName.slice(0, 1).toLocaleUpperCase('en-US')}
        </span>
        <div>
          <strong>{conversation.data.peer.displayName}</strong>
          <small>@{conversation.data.peer.username}</small>
        </div>
      </header>
      <div
        className="messageViewport"
        ref={scrollRef}
        onScroll={(event) => {
          const viewport = event.currentTarget;
          nearBottomRef.current =
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100;
        }}
      >
        {messagesQuery.hasNextPage ? (
          <button
            className="loadOlder"
            type="button"
            disabled={messagesQuery.isFetchingNextPage}
            onClick={() => void loadOlder()}
          >
            {messagesQuery.isFetchingNextPage ? 'Loading…' : 'Load older messages'}
          </button>
        ) : null}
        {messagesQuery.isPending ? (
          <div className="messageState">Loading messages&hellip;</div>
        ) : messagesQuery.isError ? (
          <div className="messageState" role="alert">
            Messages could not be loaded.
          </div>
        ) : messages.length === 0 && pending.length === 0 ? (
          <div className="messageState">Say hello.</div>
        ) : (
          <ol className="messageList" aria-live="polite">
            {messages.map((message) => (
              <li className={message.senderId === user?.id ? 'ownMessage' : ''} key={message.id}>
                <p>{message.text}</p>
                <time dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </li>
            ))}
            {pending.map((message) => (
              <li className="ownMessage pendingMessage" key={message.clientMessageId}>
                <p>{message.text}</p>
                {message.state === 'failed' ? (
                  <button
                    type="button"
                    onClick={() => attemptSend(message.clientMessageId, message.text)}
                  >
                    Retry
                  </button>
                ) : (
                  <small>Sending&hellip;</small>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      {conversation.data.blocked ? (
        <div className="composerDisabled" role="status">
          New messages are unavailable. Existing history remains visible.
        </div>
      ) : (
        <form className="messageComposer" onSubmit={submit}>
          <label className="srOnly" htmlFor="message-text">
            Message
          </label>
          <textarea
            id="message-text"
            maxLength={4_000}
            placeholder={`Message ${conversation.data.peer.displayName}`}
            rows={1}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" disabled={!text.trim()}>
            Send
          </button>
        </form>
      )}
    </div>
  );
}
