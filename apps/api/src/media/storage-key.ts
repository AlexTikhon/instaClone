const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const originalMediaKey = (ownerId: string, mediaId: string): string => {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(mediaId)) {
    throw new Error('Storage keys require canonical UUID identifiers');
  }
  return `users/${ownerId}/media/${mediaId}/original`;
};

export const thumbnailMediaKey = (ownerId: string, mediaId: string): string => {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(mediaId)) {
    throw new Error('Storage keys require canonical UUID identifiers');
  }
  return `users/${ownerId}/media/${mediaId}/thumb-640`;
};
