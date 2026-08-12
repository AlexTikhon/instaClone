import type { Profile, UpdateProfileInput, UserRole } from '@instaclone/api-contracts';

export interface IdentityRecord {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  disabledAt: Date | null;
  role: UserRole;
  passwordHash: string;
  profile: Profile;
}

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
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
  sessionMetadata: SessionMetadata;
}

export interface SessionMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuditEventInput extends SessionMetadata {
  userId: string | null;
  sessionId: string | null;
  eventType:
    | 'REGISTER'
    | 'LOGIN'
    | 'LOGIN_FAILED'
    | 'REFRESH'
    | 'REFRESH_REUSE'
    | 'LOGOUT'
    | 'EMAIL_VERIFICATION_SENT'
    | 'EMAIL_VERIFIED'
    | 'PASSWORD_RESET_REQUESTED'
    | 'PASSWORD_RESET_COMPLETED'
    | 'PASSWORD_CHANGED'
    | 'SESSION_REVOKED'
    | 'ALL_SESSIONS_REVOKED';
  outcome: 'SUCCESS' | 'FAILURE';
}

export interface SessionSummary extends SessionMetadata {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface CleanupResult {
  sessions: number;
  verificationTokens: number;
  resetTokens: number;
  auditEvents: number;
}

export type UpdateProfileData = Omit<UpdateProfileInput, 'websiteUrl'> & {
  websiteUrl?: string | null;
};

export type RotationResult = 'rotated' | 'reused' | 'invalid';
