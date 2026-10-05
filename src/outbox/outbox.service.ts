import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { EventType } from './domain-event';
import { requestContext } from './request-context';

@Injectable()
export class OutboxService {
  // The caller's transaction owns both the business change and its event.
  async record(
    tx: Prisma.TransactionClient,
    eventType: EventType,
    aggregateId: string,
    payload: Prisma.InputJsonObject,
  ): Promise<void> {
    await tx.outboxEvent.upsert({
      where: { eventKey: `${eventType}:${aggregateId}` },
      create: {
        eventKey: `${eventType}:${aggregateId}`,
        eventType,
        aggregateId,
        payload,
        correlationId: requestContext.getStore()?.correlationId ?? aggregateId,
      },
      update: {},
    });
  }
}
