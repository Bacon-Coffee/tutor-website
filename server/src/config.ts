/** 运行期配置。全部可以用环境变量覆盖，Docker 里就是这么注入的。 */
export const config = {
  /** SQLite 文件路径。相对路径按进程工作目录解析。 */
  databaseFile: process.env.DATABASE_FILE ?? 'data/app.db',
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  /** 对外可访问的根地址，用来拼管理链接。上线后改成 https://你的域名 */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  /** 公开预约接口的限流：同一 IP 在时间窗内最多提交几次。 */
  bookingRateLimit: {
    max: Number(process.env.BOOKING_RATE_LIMIT_MAX ?? 3),
    timeWindow: process.env.BOOKING_RATE_LIMIT_WINDOW ?? '10 minutes',
  } satisfies RateLimitOptions,
};

export interface RateLimitOptions {
  max: number;
  /** @fastify/rate-limit 的写法，如 '10 minutes'。 */
  timeWindow: string;
}

/** 私密管理链接。token 放在 # 后面，不会进服务器访问日志、也不会随 Referer 外泄。 */
export function adminUrl(token: string): string {
  return `${config.publicBaseUrl}/admin#${token}`;
}

export function publicUrl(slug: string): string {
  return `${config.publicBaseUrl}/u/${slug}`;
}
