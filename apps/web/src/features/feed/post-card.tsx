'use client';

import Image from 'next/image';
import { useState } from 'react';

import type { FeedItem } from '@instaclone/api-contracts';

import { CommentsPanel } from '../comments/comments-panel';
import { useLikePost, useSavePost } from './use-engagement-mutations';
import { ReportDialog } from '../moderation/report-dialog';
import { useAuth } from '../auth/auth-provider';

export function PostCard({ item }: { item: FeedItem }) {
  const [showComments, setShowComments] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const { user } = useAuth();
  const like = useLikePost(item.post.id);
  const save = useSavePost(item.post.id);
  const media = item.post.media[0];
  return (
    <article className="postCard">
      <header className="postHeader">
        <div>
          <strong>@{item.post.author.username}</strong>
          <span>{item.post.author.displayName}</span>
        </div>
        <time dateTime={item.post.createdAt}>{new Date(item.post.createdAt).toLocaleString()}</time>
      </header>
      {media?.url ? (
        <Image
          className="postMedia"
          src={media.url}
          alt={item.post.caption || `Post by ${item.post.author.username}`}
          width={media.width ?? 640}
          height={media.height ?? 640}
          unoptimized
        />
      ) : null}
      <div className="postActions">
        <button
          type="button"
          className={item.engagement.viewerHasLiked ? 'activeAction' : 'secondaryButton'}
          disabled={like.isPending}
          aria-pressed={item.engagement.viewerHasLiked}
          onClick={() => like.mutate(!item.engagement.viewerHasLiked)}
        >
          {item.engagement.viewerHasLiked ? 'Unlike' : 'Like'} · {item.engagement.likeCount}
        </button>
        {user?.id !== item.post.author.userId ? (
          <button type="button" className="secondaryButton" onClick={() => setShowReport(true)}>
            Report
          </button>
        ) : null}
        <button
          type="button"
          className="secondaryButton"
          aria-expanded={showComments}
          onClick={() => setShowComments((current) => !current)}
        >
          Comments · {item.engagement.commentCount}
        </button>
        <button
          type="button"
          className={item.engagement.viewerHasSaved ? 'activeAction' : 'secondaryButton'}
          disabled={save.isPending}
          aria-pressed={item.engagement.viewerHasSaved}
          onClick={() => save.mutate(!item.engagement.viewerHasSaved)}
        >
          {item.engagement.viewerHasSaved ? 'Saved' : 'Save'}
        </button>
      </div>
      {item.post.caption ? (
        <p className="caption">
          <strong>@{item.post.author.username}</strong> {item.post.caption}
        </p>
      ) : null}
      {like.isError || save.isError ? (
        <p className="formError">
          The change could not be saved. Your previous state was restored.
        </p>
      ) : null}
      {showComments ? <CommentsPanel postId={item.post.id} /> : null}
      {showReport ? (
        <ReportDialog
          targetType="POST"
          targetId={item.post.id}
          targetLabel="post"
          onClose={() => setShowReport(false)}
        />
      ) : null}
    </article>
  );
}
