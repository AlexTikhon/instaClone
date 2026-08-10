import type {
  AuditEventInput,
  CleanupResult,
  CreateIdentityInput,
  IdentityRecord,
  RotationResult,
  SessionRecord,
  SessionMetadata,
  SessionSummary,
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
    metadata: SessionMetadata,
  ): Promise<void>;
  rotateRefreshToken(
    sessionId: string,
    presentedTokenHash: string,
    nextTokenHash: string,
    expiresAt: Date,
    now: Date,
  ): Promise<RotationResult>;
  revokeSession(sessionId: string, reason: 'LOGOUT' | 'SECURITY_EVENT'): Promise<void>;
  revokeOwnedSession(userId: string, sessionId: string): Promise<boolean>;
  revokeAllSessions(userId: string, reason: 'PASSWORD_CHANGE' | 'SECURITY_EVENT'): Promise<number>;
  listSessions(userId: string, now: Date): Promise<SessionSummary[]>;
  createEmailVerificationToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  consumeEmailVerificationToken(tokenHash: string, now: Date): Promise<string | null>;
  createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  resetPassword(tokenHash: string, passwordHash: string, now: Date): Promise<string | null>;
  changePassword(userId: string, passwordHash: string, now: Date): Promise<void>;
  recordAuditEvent(event: AuditEventInput): Promise<void>;
  cleanupExpiredAuthState(now: Date, auditBefore: Date): Promise<CleanupResult>;
  findProfileByUsername(username: string): Promise<IdentityRecord['profile'] | null>;
  updateProfile(userId: string, input: UpdateProfileData): Promise<IdentityRecord['profile']>;
}
