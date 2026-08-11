import type { StoryAuthorGroup } from '@instaclone/api-contracts';

export interface StoryLifecycleState {
  deletedAt: Date | null;
  expiresAt: Date;
}

export const isStoryActive = (story: StoryLifecycleState, now: Date): boolean =>
  story.deletedAt === null && story.expiresAt.getTime() > now.getTime();

export const hasUnseenStories = (isViewer: boolean, viewedStates: boolean[]): boolean =>
  !isViewer && viewedStates.some((viewed) => !viewed);

export const compareStoryPlayback = (
  left: { id: string; createdAt: Date },
  right: { id: string; createdAt: Date },
): number =>
  left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id);

export const compareStoryAuthorGroups = (
  left: StoryAuthorGroup,
  right: StoryAuthorGroup,
): number => {
  if (left.hasUnseenStories !== right.hasUnseenStories) {
    return left.hasUnseenStories ? -1 : 1;
  }
  const timeDifference = Date.parse(right.latestStoryAt) - Date.parse(left.latestStoryAt);
  return timeDifference || right.author.id.localeCompare(left.author.id);
};
