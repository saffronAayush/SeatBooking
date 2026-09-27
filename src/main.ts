import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // Trusts X-Forwarded-* headers added by a reverse proxy/load balancer.
  // Enable only when clients cannot bypass a trusted proxy that sanitizes these headers.
  app.set('trust proxy', true);

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    // Uses DTO validation metadata to control which incoming values are accepted.
    new ValidationPipe({
      // Keeps only properties that have validation decorators in the DTO.
      whitelist: true,
      // throws error for the abover one.
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SeatForge API')
    .setDescription('Concurrency-safe ticket booking platform')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig)); // can see the documentation at server_url/docs

  const config = app.get(ConfigService);
  await app.listen(config.get<number>('PORT', 3000), '0.0.0.0');
}

void bootstrap();
