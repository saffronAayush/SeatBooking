import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
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
  PAYMENT_SIMULATOR_SECRET: Joi.string()
    .min(32)
    .default('local-payment-simulator-secret-123456'),
});
