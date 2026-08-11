'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { createComment, deleteComment, getComments } from '../../entities/engagement/api';
import { queryKeys } from '../feed/query-keys';

export function CommentsPanel({ postId }: { postId: string }) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const comments = useInfiniteQuery({
    queryKey: queryKeys.comments(postId),
    queryFn: ({ pageParam }) => getComments(postId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.comments(postId) }),
      client.invalidateQueries({ queryKey: queryKeys.feed }),
    ]);
  };
  const add = useMutation({
    mutationFn: (body: string) => createComment(postId, body),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: deleteComment, onSuccess: refresh });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const value = new FormData(form).get('comment');
    const body = typeof value === 'string' ? value.trim() : '';
    if (!body) return;
    try {
      await add.mutateAsync(body);
      form.reset();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Comment failed');
    }
  };

  if (comments.isPending) return <p role="status">Loading comments…</p>;
  if (comments.isError) return <p className="formError">Comments could not be loaded.</p>;

  const rows = comments.data.pages.flatMap((page) => page.comments);
  return (
    <section className="comments" aria-label="Comments">
      <form className="commentForm" onSubmit={(event) => void submit(event)}>
        <label className="srOnly" htmlFor={`comment-${postId}`}>
          Add a comment
        </label>
        <input
          id={`comment-${postId}`}
          name="comment"
          maxLength={1000}
          placeholder="Add a comment"
        />
        <button type="submit" disabled={add.isPending}>
          Post
        </button>
      </form>
      {error && (
        <p className="formError" role="alert">
          {error}
        </p>
      )}
      {rows.length === 0 ? <p className="muted">No comments yet.</p> : null}
      <ul className="commentList">
        {rows.map((comment) => (
          <li key={comment.id}>
            <p>
              <strong>@{comment.author.username}</strong> {comment.body}
            </p>
            {comment.viewerCanDelete ? (
              <button
                type="button"
                className="textButton"
                disabled={remove.isPending}
                onClick={() => remove.mutate(comment.id)}
              >
                Delete
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {comments.hasNextPage ? (
        <button
          type="button"
          className="secondaryButton"
          disabled={comments.isFetchingNextPage}
          onClick={() => void comments.fetchNextPage()}
        >
          {comments.isFetchingNextPage ? 'Loading…' : 'More comments'}
        </button>
      ) : null}
    </section>
  );
}
