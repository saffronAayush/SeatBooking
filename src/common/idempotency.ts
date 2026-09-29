import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

export function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key) throw new BadRequestException('Idempotency-Key header is required');
  if (key.length > 200) throw new BadRequestException('Idempotency-Key is too long');
  return key;
}

export function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function replayResponse(
  record: { requestHash: string; response: Prisma.JsonValue } | null,
  hash: string,
): Prisma.JsonValue | undefined {
  if (!record) return undefined;
  if (record.requestHash !== hash) {
    throw new ConflictException('Idempotency-Key was already used with a different request');
  }
  return record.response;
}
