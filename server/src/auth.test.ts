import { expect, test } from 'vitest';
import { createAdminToken, hashToken } from './auth.js';

test('同一个 token 的哈希结果稳定', () => {
  expect(hashToken('abc')).toBe(hashToken('abc'));
});

test('不同 token 的哈希结果不同', () => {
  expect(hashToken('abc')).not.toBe(hashToken('abd'));
});

test('哈希结果里不含原始 token', () => {
  const token = createAdminToken();

  expect(hashToken(token)).not.toContain(token);
});

test('每次生成的 token 都不同，且可直接放进 URL', () => {
  const a = createAdminToken();
  const b = createAdminToken();

  expect(a).not.toBe(b);
  expect(a).toMatch(/^[A-Za-z0-9_-]{32,}$/);
});
