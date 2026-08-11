import { randomUUID } from 'node:crypto';

export interface NewOutboxEvent<TPayload> {
  eventId: string;
  eventName: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  occurredAt: Date;
  correlationId: string;
  payload: TPayload;
}

export const createOutboxEvent = <TPayload>(input: {
  eventName: string;
  aggregateType: string;
  aggregateId: string;
  correlationId: string;
  payload: TPayload;
  eventId?: string;
  occurredAt?: Date;
}): NewOutboxEvent<TPayload> => ({
  eventId: input.eventId ?? randomUUID(),
  eventName: input.eventName,
  eventVersion: 1,
  aggregateType: input.aggregateType,
  aggregateId: input.aggregateId,
  occurredAt: input.occurredAt ?? new Date(),
  correlationId: input.correlationId,
  payload: input.payload,
});
