import { createHash, randomBytes } from 'node:crypto';

/**
 * 生成管理链接用的随机 token。
 * 24 字节随机数 → 32 个 base64url 字符，可以直接放进 URL 的 hash 部分。
 */
export function createAdminToken(): string {
  return randomBytes(24).toString('base64url');
}

/** 数据库里只存 token 的 SHA-256，明文 token 只在生成的那一刻出现过。 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
