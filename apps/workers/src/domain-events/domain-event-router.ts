import type { EventEnvelope } from '@instaclone/api-contracts';

export interface DomainEventHandler<TResult = unknown> {
  handle(input: unknown): Promise<TResult>;
}

export class DomainEventRouter {
  constructor(private readonly handlers: ReadonlyMap<string, DomainEventHandler>) {}

  handle(jobName: string, event: EventEnvelope): Promise<unknown> {
    if (jobName !== event.eventName) {
      return Promise.reject(new Error('Domain job name does not match its event envelope'));
    }
    const handler = this.handlers.get(event.eventName);
    if (!handler) return Promise.reject(new Error(`Unsupported domain event: ${event.eventName}`));
    return handler.handle(event);
  }
}

export class ValidatedEventHandler {
  constructor(private readonly parse: (input: unknown) => unknown) {}

  handle(input: unknown): Promise<{ status: 'VALIDATED' }> {
    this.parse(input);
    return Promise.resolve({ status: 'VALIDATED' });
  }
}
