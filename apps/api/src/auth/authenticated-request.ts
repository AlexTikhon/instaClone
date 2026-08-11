import type { Request } from 'express';

import type { AuthenticatedUser } from '@instaclone/api-contracts';

export type RequestIdentity = AuthenticatedUser & { sessionId: string };
export type AuthenticatedRequest = Request & { id: string; identity: RequestIdentity };
