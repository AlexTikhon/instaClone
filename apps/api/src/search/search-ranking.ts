export const USER_SEARCH_RANK = {
  exactUsername: 1,
  usernamePrefix: 2,
  exactDisplayName: 3,
  displayNamePrefix: 4,
  usernameContains: 5,
  displayNameContains: 6,
} as const;

/** Escapes PostgreSQL LIKE metacharacters so user input is always treated as literal text. */
export const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

export const EXPLORE_WINDOW_DAYS = 30;
export const EXPLORE_FRESHNESS_HOURS = 168;
export const EXPLORE_LIKE_WEIGHT = 3;
export const EXPLORE_COMMENT_WEIGHT = 5;
