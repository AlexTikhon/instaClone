import { z } from 'zod';

import { realtimeMessageCreatedSchema } from './messaging-contracts';
import { realtimeNotificationMessageSchema } from './notification-contracts';

export const applicationRealtimeMessageSchema = z.discriminatedUnion('event', [
  realtimeNotificationMessageSchema,
  realtimeMessageCreatedSchema,
]);

export const applicationRealtimeEnvelopeSchema = z.strictObject({
  recipientId: z.uuid(),
  message: applicationRealtimeMessageSchema,
});

export type ApplicationRealtimeMessage = z.infer<typeof applicationRealtimeMessageSchema>;
export type ApplicationRealtimeEnvelope = z.infer<typeof applicationRealtimeEnvelopeSchema>;
