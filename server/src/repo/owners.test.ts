import { expect, test } from 'vitest';
import { openDatabase } from '../db/index.js';
import { createOwner, findOwnerByToken, rotateAdminToken } from './owners.js';

const db = () => openDatabase(':memory:');

test('createOwner 返回明文 token，数据库里只存哈希', () => {
  const conn = db();

  const { token } = createOwner(conn, { id: 'xavier', displayName: '我' });

  const row = conn.prepare("SELECT admin_token_hash FROM owners WHERE id = 'xavier'").get() as {
    admin_token_hash: string;
  };
  expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  expect(row.admin_token_hash).not.toBe(token);
});

test('拿 createOwner 返回的 token 能找回这个人', () => {
  const conn = db();
  const { token } = createOwner(conn, { id: 'xavier', displayName: '我' });

  expect(findOwnerByToken(conn, token)?.id).toBe('xavier');
});

test('错误的 token 找不到任何人', () => {
  const conn = db();
  createOwner(conn, { id: 'xavier', displayName: '我' });

  expect(findOwnerByToken(conn, '不是我的token')).toBeUndefined();
});

test('没指定的设置项走 schema 默认值', () => {
  const conn = db();
  createOwner(conn, { id: 'xavier', displayName: '我' });

  const owner = conn.prepare("SELECT * FROM owners WHERE id = 'xavier'").get() as Record<string, unknown>;
  expect(owner).toMatchObject({
    bio: '',
    timezone: 'Asia/Shanghai',
    slot_minutes: 30,
    horizon_weeks: 4,
    min_notice_hours: 2,
  });
});

test('createOwner 可以覆盖默认设置', () => {
  const conn = db();
  createOwner(conn, {
    id: 'friend',
    displayName: '朋友',
    bio: '雅思口语对练',
    slotMinutes: 60,
  });

  const owner = conn.prepare("SELECT * FROM owners WHERE id = 'friend'").get() as Record<string, unknown>;
  expect(owner).toMatchObject({ bio: '雅思口语对练', slot_minutes: 60 });
});

test('换过 token 之后旧链接失效、新链接生效', () => {
  const conn = db();
  const { token: oldToken } = createOwner(conn, { id: 'xavier', displayName: '我' });

  const newToken = rotateAdminToken(conn, 'xavier');

  expect(newToken).not.toBe(oldToken);
  expect(findOwnerByToken(conn, oldToken)).toBeUndefined();
  expect(findOwnerByToken(conn, newToken)?.id).toBe('xavier');
});
