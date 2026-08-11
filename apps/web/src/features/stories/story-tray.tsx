'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { StoryViewer } from './story-viewer';
import { storySequenceQueryOptions, useStoryTray } from './use-stories';

interface OpenViewer {
  authorIndex: number;
  storyIndex: number;
  instance: number;
}

export function StoryTray() {
  const tray = useStoryTray();
  const queryClient = useQueryClient();
  const [viewer, setViewer] = useState<OpenViewer | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const viewerInstance = useRef(0);

  if (tray.isPending)
    return <section className="storyTray storyTrayLoading" aria-label="Stories" aria-busy="true" />;
  if (tray.isError)
    return (
      <section className="storyTrayState" role="alert">
        <span>Stories are unavailable.</span>
        <button type="button" onClick={() => void tray.refetch()}>
          Retry
        </button>
      </section>
    );

  const groups = tray.data.groups;
  const open = async (authorIndex: number) => {
    const group = groups[authorIndex];
    if (!group) return;
    setOpenError(null);
    try {
      const sequence = await queryClient.fetchQuery(storySequenceQueryOptions(group.author.id));
      const firstUnseen = sequence.stories.findIndex((story) => !story.viewerHasViewed);
      viewerInstance.current += 1;
      setViewer({
        authorIndex,
        storyIndex: firstUnseen >= 0 ? firstUnseen : 0,
        instance: viewerInstance.current,
      });
    } catch {
      setOpenError('That Story is no longer available.');
      await tray.refetch();
    }
  };

  return (
    <>
      <section className="storyTray" aria-label="Stories">
        {groups.length === 0 ? <p>No active Stories yet.</p> : null}
        {groups.map((group, index) => (
          <button
            key={group.author.id}
            type="button"
            className={`storyTrayItem ${group.hasUnseenStories ? 'unseen' : 'seen'}`}
            aria-label={`View ${group.isViewer ? 'Your Story' : `${group.author.displayName}'s Stories`}`}
            onClick={() => void open(index)}
          >
            <span className="storyAvatar" aria-hidden="true">
              {group.author.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span>{group.isViewer ? 'Your Story' : group.author.username}</span>
          </button>
        ))}
      </section>
      {openError ? (
        <p className="formError" role="alert">
          {openError}
        </p>
      ) : null}
      {viewer ? (
        <StoryViewer
          key={viewer.instance}
          groups={groups}
          initialAuthorIndex={viewer.authorIndex}
          initialStoryIndex={viewer.storyIndex}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </>
  );
}
