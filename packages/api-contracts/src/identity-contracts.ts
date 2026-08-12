import { z } from 'zod';

const usernamePattern = /^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])?$/;

export const profileSchema = z.object({
  userId: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  bio: z.string(),
  websiteUrl: z.url().nullable(),
  isPrivate: z.boolean(),
});

export const userRoleSchema = z.enum(['USER', 'MODERATOR', 'ADMIN']);

export const authenticatedUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  emailVerified: z.boolean(),
  role: userRoleSchema,
  profile: profileSchema,
});

export const authResponseSchema = z.object({ user: authenticatedUserSchema });
export const csrfResponseSchema = z.object({ csrfToken: z.string().min(1) });

export const registerInputSchema = z.strictObject({
  email: z
    .email()
    .max(320)
    .transform((value) => value.trim().toLowerCase()),
  password: z.string().min(12).max(128),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(30)
    .regex(
      usernamePattern,
      'Username may contain lowercase letters, numbers, dots, and underscores',
    ),
  displayName: z.string().trim().min(1).max(60),
});

export const loginInputSchema = z.strictObject({
  email: z
    .email()
    .max(320)
    .transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1).max(128),
});

export const verifyEmailInputSchema = z.strictObject({ token: z.string().min(32).max(512) });

export const forgotPasswordInputSchema = z.strictObject({
  email: z
    .email()
    .max(320)
    .transform((value) => value.trim().toLowerCase()),
});

export const resetPasswordInputSchema = z.strictObject({
  token: z.string().min(32).max(512),
  newPassword: z.string().min(12).max(128),
});

export const changePasswordInputSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(12).max(128),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'New password must differ from the current password',
    path: ['newPassword'],
  });

export const acceptedResponseSchema = z.object({ accepted: z.literal(true) });

export const authSessionSchema = z.object({
  id: z.uuid(),
  current: z.boolean(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});

export const authSessionsResponseSchema = z.object({ sessions: z.array(authSessionSchema) });

export const updateProfileInputSchema = z
  .strictObject({
    username: z.string().trim().toLowerCase().min(3).max(30).regex(usernamePattern).optional(),
    displayName: z.string().trim().min(1).max(60).optional(),
    bio: z.string().trim().max(160).optional(),
    websiteUrl: z.union([z.url().max(2048), z.literal(''), z.null()]).optional(),
    isPrivate: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export type Profile = z.infer<typeof profileSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type CsrfResponse = z.infer<typeof csrfResponseSchema>;
export type RegisterInput = z.infer<typeof registerInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailInputSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type AuthSessionsResponse = z.infer<typeof authSessionsResponseSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;
