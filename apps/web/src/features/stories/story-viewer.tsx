'use client';

import Image from 'next/image';
import { useEffect, useReducer, useRef, useState } from 'react';

import type { StoryAuthorGroup } from '@instaclone/api-contracts';

import { storyViewerReducer, type StoryViewerState } from './story-viewer-reducer';
import {
  useDeleteStory,
  useRecordStoryView,
  useStorySequence,
  useStoryViewers,
} from './use-stories';

const IMAGE_DISPLAY_MS = 6_000;

interface StoryViewerProps {
  groups: StoryAuthorGroup[];
  initialAuthorIndex: number;
  initialStoryIndex: number;
  onClose: () => void;
}

export function StoryViewer({
  groups,
  initialAuthorIndex,
  initialStoryIndex,
  onClose,
}: StoryViewerProps) {
  const initialState: StoryViewerState = {
    isOpen: true,
    authorIndex: initialAuthorIndex,
    storyIndex: initialStoryIndex,
  };
  const [state, dispatch] = useReducer(storyViewerReducer, initialState);
  const group = groups[state.authorIndex];
  const sequence = useStorySequence(group?.author.id ?? '');
  const currentStory = sequence.data?.stories[state.storyIndex];
  const recordView = useRecordStoryView();
  const deleteStory = useDeleteStory();
  const viewedStoryIds = useRef(new Set<string>());
  const [showViewers, setShowViewers] = useState(false);
  const viewers = useStoryViewers(currentStory?.id ?? '', showViewers && Boolean(group?.isViewer));

  const next = () => {
    setShowViewers(false);
    dispatch({
      type: 'NEXT',
      storyCount: sequence.data?.stories.length ?? 0,
      authorCount: groups.length,
    });
  };
  const previous = () => {
    setShowViewers(false);
    dispatch({
      type: 'PREVIOUS',
      previousAuthorStoryCount: groups[state.authorIndex - 1]?.storyCount ?? 0,
    });
  };
  const close = () => dispatch({ type: 'CLOSE' });

  useEffect(() => {
    if (!state.isOpen) onClose();
  }, [onClose, state.isOpen]);

  useEffect(() => {
    if (!sequence.isError && (!sequence.isSuccess || currentStory)) return;
    dispatch({
      type: 'STORY_UNAVAILABLE',
      storyCount: sequence.data?.stories.length ?? 0,
      authorCount: groups.length,
    });
  }, [
    currentStory,
    groups.length,
    sequence.data?.stories.length,
    sequence.isError,
    sequence.isSuccess,
  ]);

  useEffect(() => {
    if (!currentStory || !group || group.isViewer || viewedStoryIds.current.has(currentStory.id)) {
      return;
    }
    viewedStoryIds.current.add(currentStory.id);
    recordView.mutate({ storyId: currentStory.id, authorId: group.author.id });
  }, [currentStory, group, recordView]);

  useEffect(() => {
    if (!currentStory) return;
    const timer = setTimeout(
      () =>
        dispatch({
          type: 'NEXT',
          storyCount: sequence.data?.stories.length ?? 0,
          authorCount: groups.length,
        }),
      IMAGE_DISPLAY_MS,
    );
    return () => clearTimeout(timer);
  }, [currentStory, groups.length, sequence.data?.stories.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') next();
      if (event.key === 'ArrowLeft') previous();
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!state.isOpen || !group) return null;

  return (
    <div className="storyViewerBackdrop" role="dialog" aria-modal="true" aria-label="Story viewer">
      <div className="storyViewer">
        <div className="storyProgress" aria-label="Story progress">
          {Array.from({ length: sequence.data?.stories.length ?? group.storyCount }, (_, index) => (
            <span key={index} className={index <= state.storyIndex ? 'complete' : ''} />
          ))}
        </div>
        <header className="storyViewerHeader">
          <div>
            <strong>{group.isViewer ? 'Your Story' : group.author.displayName}</strong>
            <span>@{group.author.username}</span>
          </div>
          <button
            type="button"
            className="secondaryButton"
            aria-label="Close Story"
            onClick={close}
          >
            Close
          </button>
        </header>
        {sequence.isPending ? <p role="status">Loading Story…</p> : null}
        {sequence.isError ? <p role="alert">This Story is no longer available.</p> : null}
        {currentStory?.media.url ? (
          <Image
            className="storyImage"
            src={currentStory.media.url}
            alt={`${group.author.displayName}'s Story`}
            width={currentStory.media.width ?? 640}
            height={currentStory.media.height ?? 800}
            unoptimized
            priority
          />
        ) : currentStory ? (
          <p role="alert">Story media is unavailable.</p>
        ) : null}
        <div className="storyViewerActions">
          <button type="button" className="secondaryButton" onClick={previous}>
            Previous
          </button>
          <button type="button" onClick={next}>
            Next
          </button>
          {group.isViewer && currentStory ? (
            <>
              <button
                type="button"
                className="secondaryButton"
                onClick={() => setShowViewers((value) => !value)}
              >
                Viewers
              </button>
              <button
                type="button"
                className="secondaryButton"
                disabled={deleteStory.isPending}
                onClick={() =>
                  deleteStory.mutate(
                    { storyId: currentStory.id, authorId: group.author.id },
                    {
                      onSuccess: () => {
                        setShowViewers(false);
                        dispatch({
                          type: 'STORY_UNAVAILABLE',
                          storyCount: sequence.data?.stories.length ?? 0,
                          authorCount: groups.length,
                        });
                      },
                    },
                  )
                }
              >
                Delete
              </button>
            </>
          ) : null}
        </div>
        {showViewers && currentStory ? (
          <section className="storyViewers" aria-label="Story viewers">
            {viewers.isPending ? <p>Loading viewers…</p> : null}
            {viewers.isError ? <p role="alert">Viewers are unavailable.</p> : null}
            {viewers.data?.pages.flatMap((page) => page.viewers).length === 0 ? (
              <p>No views yet.</p>
            ) : null}
            <ul>
              {viewers.data?.pages.flatMap((page) =>
                page.viewers.map((viewer) => (
                  <li key={viewer.user.id}>
                    <span>{viewer.user.displayName}</span>
                    <small>@{viewer.user.username}</small>
                  </li>
                )),
              )}
            </ul>
            {viewers.hasNextPage ? (
              <button type="button" onClick={() => void viewers.fetchNextPage()}>
                Load more viewers
              </button>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
