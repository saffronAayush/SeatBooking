import { isUUID } from 'class-validator';
import { Prisma } from '../generated/prisma/client';

export const eventTypes = [
  'SeatHoldCreated',
  'SeatHoldReleased',
  'SeatHoldExpired',
  'BookingConfirmed',
  'BookingCancelled',
  'PaymentFailed',
  'RefundSucceeded',
] as const;

export type EventType = (typeof eventTypes)[number];

export interface DomainEvent {
  id: string;
  type: EventType;
  version: 1;
  aggregateId: string;
  correlationId: string;
  occurredAt: string;
  payload: Prisma.JsonObject;
}

export function parseEvent(content: Buffer, messageId?: string): DomainEvent {
  const value: unknown = JSON.parse(content.toString('utf8'));
  if (!value || typeof value !== 'object') throw new Error('INVALID_EVENT');
  const event = value as Partial<DomainEvent>;
  if (
    typeof event.id !== 'string' ||
    !isUUID(event.id) ||
    event.id !== messageId ||
    typeof event.aggregateId !== 'string' ||
    !isUUID(event.aggregateId) ||
    event.version !== 1 ||
    !eventTypes.includes(event.type as EventType) ||
    typeof event.correlationId !== 'string' ||
    event.correlationId.length > 128 ||
    typeof event.occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(event.occurredAt)) ||
    !event.payload ||
    typeof event.payload !== 'object' ||
    Array.isArray(event.payload)
  )
    throw new Error('INVALID_EVENT');
  return event as DomainEvent;
}
