import './observability/telemetry';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker/worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Background worker started');
}

void bootstrap().catch(() => {
  process.stderr.write('Background worker failed to start. Check configuration.\n');
  process.exitCode = 1;
});
