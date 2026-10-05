import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Channel, ChannelModel, ConfirmChannel, ConsumeMessage, Options, connect } from 'amqplib';
import { eventTypes } from '../outbox/domain-event';

export const EVENTS_EXCHANGE = 'seatforge.events';
export const RETRY_EXCHANGE = 'seatforge.retry';
export const DEAD_EXCHANGE = 'seatforge.dead';
export const WORK_QUEUE = 'seatforge.notifications';
export const DEAD_QUEUE = 'seatforge.notifications.dead';

interface Session {
  connection: ChannelModel;
  publisher: ConfirmChannel;
  consumer: Channel;
  consumerTag?: string;
}

@Injectable()
export class RabbitMqService {
  private readonly logger = new Logger(RabbitMqService.name);
  private session?: Session;
  private connecting?: Promise<Session>;
  private stopping = false;
  private accepting = true;
  private readonly deliveries = new Set<Promise<void>>();

  constructor(private readonly config: ConfigService) {}

  retryDelay(attempt: number): number {
    return Math.min(
      this.config.get<number>('WORKER_RETRY_BASE_MS', 1000) * 2 ** (attempt - 1),
      this.config.get<number>('WORKER_RETRY_MAX_MS', 60000),
    );
  }

  private async open(): Promise<Session> {
    const connection = await connect(this.config.getOrThrow<string>('RABBITMQ_URL'), {
      timeout: this.config.get<number>('RABBITMQ_TIMEOUT_MS', 5000),
    });
    connection.on('error', () => this.logger.warn('RabbitMQ connection interrupted'));
    const invalidate = () => {
      if (this.session?.connection === connection) this.session = undefined;
    };
    connection.on('close', invalidate);
    try {
      const publisher = await connection.createConfirmChannel();
      publisher.setMaxListeners(this.config.get<number>('WORKER_PREFETCH', 10) + 10);
      const consumer = await connection.createChannel();
      for (const channel of [publisher, consumer]) {
        channel.on('error', () => this.logger.warn('RabbitMQ channel interrupted'));
        channel.on('close', () => {
          invalidate();
          void connection.close().catch(() => undefined);
        });
      }
      await publisher.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
      await publisher.assertExchange(RETRY_EXCHANGE, 'direct', { durable: true });
      await publisher.assertExchange(DEAD_EXCHANGE, 'direct', { durable: true });
      await publisher.assertQueue(DEAD_QUEUE, {
        durable: true,
        arguments: { 'x-queue-type': 'quorum' },
      });
      await publisher.bindQueue(DEAD_QUEUE, DEAD_EXCHANGE, WORK_QUEUE);
      await publisher.assertQueue(WORK_QUEUE, {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum',
          'x-delivery-limit': 20,
          'x-dead-letter-exchange': DEAD_EXCHANGE,
          'x-dead-letter-routing-key': WORK_QUEUE,
          'x-dead-letter-strategy': 'at-least-once',
          'x-overflow': 'reject-publish',
        },
      });
      for (const type of eventTypes) await publisher.bindQueue(WORK_QUEUE, EVENTS_EXCHANGE, type);
      const retries = this.config.get<number>('WORKER_MAX_RETRIES', 5);
      for (let attempt = 1; attempt <= retries; attempt++) {
        const route = `${WORK_QUEUE}.${attempt}`;
        await publisher.assertQueue(`${WORK_QUEUE}.retry.${attempt}`, {
          durable: true,
          arguments: {
            'x-queue-type': 'quorum',
            'x-message-ttl': this.retryDelay(attempt),
            'x-dead-letter-exchange': '',
            'x-dead-letter-routing-key': WORK_QUEUE,
            'x-dead-letter-strategy': 'at-least-once',
            'x-overflow': 'reject-publish',
          },
        });
        await publisher.bindQueue(`${WORK_QUEUE}.retry.${attempt}`, RETRY_EXCHANGE, route);
      }
      await consumer.prefetch(this.config.get<number>('WORKER_PREFETCH', 10));
      if (this.stopping) throw new Error('WORKER_STOPPING');
      const session = { connection, publisher, consumer };
      this.session = session;
      this.logger.log('RabbitMQ connected and durable topology ready');
      return session;
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  private async getSession(): Promise<Session> {
    if (this.stopping) throw new Error('WORKER_STOPPING');
    if (this.session) return this.session;
    if (!this.connecting) {
      this.connecting = this.open().finally(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  async publish(
    exchange: string,
    route: string,
    body: Buffer,
    properties: Options.Publish,
  ): Promise<void> {
    const { publisher, connection } = await this.getSession();
    const publishId = randomUUID();
    await new Promise<void>((resolve, reject) => {
      let returned = false;
      const onReturn = (message: ConsumeMessage) => {
        if (message.properties.headers?.['x-publish-id'] === publishId) returned = true;
      };
      const finish = (error?: Error | null) => {
        clearTimeout(timer);
        publisher.off('return', onReturn);
        if (error) reject(error);
        else if (returned) reject(new Error('UNROUTABLE_MESSAGE'));
        else resolve();
      };
      const timer = setTimeout(
        () => {
          finish(new Error('PUBLISH_CONFIRM_TIMEOUT'));
          // An ambiguous confirm can cause a duplicate; consumers deduplicate by event ID.
          if (this.session?.connection === connection) this.session = undefined;
          void connection.close().catch(() => undefined);
        },
        this.config.get<number>('RABBITMQ_TIMEOUT_MS', 5000),
      );
      publisher.on('return', onReturn);
      try {
        publisher.publish(
          exchange,
          route,
          body,
          {
            ...properties,
            persistent: true,
            mandatory: true,
            headers: { ...properties.headers, 'x-publish-id': publishId },
          },
          finish,
        );
      } catch (error) {
        finish(error instanceof Error ? error : new Error('PUBLISH_FAILED'));
      }
    });
  }

  async ensureConsumer(handler: (message: ConsumeMessage) => Promise<void>): Promise<void> {
    if (!this.accepting) return;
    const session = await this.getSession();
    if (!this.accepting || session.consumerTag) return;
    const result = await session.consumer.consume(
      WORK_QUEUE,
      (message) => {
        if (!message) {
          session.consumerTag = undefined;
          return;
        }
        const task = (async () => {
          try {
            await handler(message);
            session.consumer.ack(message);
          } catch {
            // No ack before the database or retry publish commits. Reconnect instead of
            // spinning in a tight nack/requeue loop when a dependency is unavailable.
            this.logger.warn('Delivery unfinished; reconnecting for redelivery');
            if (this.session === session) this.session = undefined;
            await session.connection.close().catch(() => undefined);
          }
        })();
        this.deliveries.add(task);
        void task.finally(() => this.deliveries.delete(task));
      },
      { noAck: false },
    );
    session.consumerTag = result.consumerTag;
  }

  async stopConsumer(): Promise<void> {
    this.accepting = false;
    await this.connecting?.catch(() => undefined);
    const session = this.session;
    if (session?.consumerTag) {
      await session.consumer.cancel(session.consumerTag).catch(() => undefined);
      session.consumerTag = undefined;
    }
    await Promise.allSettled([...this.deliveries]);
  }

  async close(): Promise<void> {
    this.stopping = true;
    await this.connecting?.catch(() => undefined);
    await this.session?.connection.close().catch(() => undefined);
    this.session = undefined;
  }
}
