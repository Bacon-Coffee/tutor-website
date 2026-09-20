import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { config, type RateLimitOptions } from './config.js';
import type { Db } from './db/index.js';
import { adminRoutes } from './routes/admin.js';
import { publicRoutes } from './routes/public.js';

export interface BuildAppOptions {
  db: Db;
  logger?: boolean;
  /** 公开预约接口的限流。默认同一 IP 10 分钟 3 次。 */
  bookingRateLimit?: RateLimitOptions;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  // global:false —— 只给明确声明的路由限流，浏览时段不受影响
  app.register(rateLimit, { global: false });
  app.register(publicRoutes, {
    db: options.db,
    bookingRateLimit: options.bookingRateLimit ?? config.bookingRateLimit,
  });
  app.register(adminRoutes, { db: options.db });

  return app;
}
