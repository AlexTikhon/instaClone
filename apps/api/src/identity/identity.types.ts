import type { Profile, UpdateProfileInput } from '@instaclone/api-contracts';

export interface IdentityRecord {
  id: string;
  email: string;
  disabledAt: Date | null;
  passwordHash: string;
  profile: Profile;
}

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  identity: IdentityRecord;
}

export interface CreateIdentityInput {
  email: string;
  passwordHash: string;
  username: string;
  displayName: string;
  sessionId: string;
  refreshTokenHash: string;
  sessionExpiresAt: Date;
}

export type UpdateProfileData = Omit<UpdateProfileInput, 'websiteUrl'> & {
  websiteUrl?: string | null;
};

export type RotationResult = 'rotated' | 'reused' | 'invalid';
