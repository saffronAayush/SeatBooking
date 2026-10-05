import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .default('redis://localhost:6379'),
  REDIS_TIMEOUT_MS: Joi.number().integer().min(100).max(5000).default(500),
  CATALOG_CACHE_TTL_SECONDS: Joi.number().integer().min(1).max(60).default(15),
  RATE_LIMIT_AUTH: Joi.number().integer().positive().default(20),
  RATE_LIMIT_HOLDS: Joi.number().integer().positive().default(30),
  RATE_LIMIT_SEATS: Joi.number().integer().positive().default(120),
  RATE_LIMIT_CATALOG: Joi.number().integer().positive().default(120),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(1).default(0),
  OPERATIONS_PORT: Joi.number().port().default(9464),
  DB_POOL_MAX: Joi.number().integer().min(1).max(50).default(10),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .default('postgresql://seatforge:seatforge@localhost:5432/seatforge?schema=public'),
  JWT_ACCESS_SECRET: Joi.string().min(32).default('local-access-secret-change-me-123456'),
  JWT_REFRESH_SECRET: Joi.string().min(32).default('local-refresh-secret-change-me-12345'),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().positive().default(900),
  JWT_REFRESH_TTL_DAYS: Joi.number().integer().positive().default(30),
  HOLD_TTL_SECONDS: Joi.number().integer().positive().default(300),
  HOLD_EXPIRY_INTERVAL_MS: Joi.number().integer().min(1000).default(5000),
  RABBITMQ_URL: Joi.string()
    .uri({ scheme: ['amqp', 'amqps'] })
    .default('amqp://seatforge:seatforge@localhost:5672?heartbeat=10'),
  RABBITMQ_TIMEOUT_MS: Joi.number().integer().min(1000).max(30000).default(5000),
  WORKER_PREFETCH: Joi.number().integer().min(1).max(100).default(10),
  WORKER_BATCH_SIZE: Joi.number().integer().min(1).max(500).default(50),
  WORKER_RECONNECT_MS: Joi.number().integer().min(1000).default(5000),
  WORKER_MAX_RETRIES: Joi.number().integer().min(0).max(10).default(5),
  WORKER_RETRY_BASE_MS: Joi.number().integer().min(1000).max(60000).default(1000),
  WORKER_RETRY_MAX_MS: Joi.number()
    .integer()
    .min(Joi.ref('WORKER_RETRY_BASE_MS'))
    .max(3600000)
    .default(60000),
  OUTBOX_POLL_INTERVAL_MS: Joi.number().integer().min(100).default(1000),
  OUTBOX_LEASE_MS: Joi.number()
    .integer()
    .min(10000)
    .greater(Joi.ref('RABBITMQ_TIMEOUT_MS'))
    .default(30000),
  RECONCILIATION_INTERVAL_MS: Joi.number().integer().min(1000).default(30000),
});
