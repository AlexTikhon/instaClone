import { Module } from '@nestjs/common';

import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { OutboxQueuePublisher } from './outbox-queue.publisher';

@Module({ providers: [OutboxDispatcherService, OutboxQueuePublisher] })
export class OutboxModule {}
