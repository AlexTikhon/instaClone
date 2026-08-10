import type {
  CreateIdentityInput,
  IdentityRecord,
  RotationResult,
  SessionRecord,
  UpdateProfileData,
} from './identity.types';

export const IDENTITY_REPOSITORY = Symbol('IDENTITY_REPOSITORY');

export class IdentityConflictError extends Error {}

export interface IdentityRepository {
  createIdentityWithSession(
    input: CreateIdentityInput,
  ): Promise<{ identity: IdentityRecord; sessionId: string }>;
  findByEmail(email: string): Promise<IdentityRecord | null>;
  findByUserId(userId: string): Promise<IdentityRecord | null>;
  findSession(sessionId: string): Promise<SessionRecord | null>;
  createSession(
    sessionId: string,
    userId: string,
    refreshTokenHash: string,
    expiresAt: Date,
  ): Promise<void>;
  rotateRefreshToken(
    sessionId: string,
    presentedTokenHash: string,
    nextTokenHash: string,
    expiresAt: Date,
    now: Date,
  ): Promise<RotationResult>;
  revokeSession(sessionId: string, reason: 'LOGOUT' | 'SECURITY_EVENT'): Promise<void>;
  findProfileByUsername(username: string): Promise<IdentityRecord['profile'] | null>;
  updateProfile(userId: string, input: UpdateProfileData): Promise<IdentityRecord['profile']>;
}
