import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openDatabase, runMigrations } from './index.js';

const INSERT_OWNER =
  "INSERT INTO owners (id, display_name, admin_token_hash, created_at) VALUES ('me','我','h','2026-09-20T00:00:00Z')";

const INSERT_BOOKING = `INSERT INTO bookings (id, owner_id, start_utc, end_utc, name, contact, reason, created_at)
  VALUES (?, 'me', '2026-09-22T11:00:00.000Z', '2026-09-22T11:30:00.000Z', '张三', 'wx1', '练口语', '2026-09-20T00:00:00Z')`;

const tableNames = (db: ReturnType<typeof openDatabase>) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);

test('打开数据库时自动建好四张业务表', () => {
  const db = openDatabase(':memory:');

  expect(tableNames(db)).toEqual(
    expect.arrayContaining(['availability_overrides', 'availability_rules', 'bookings', 'owners']),
  );
});

test('重复执行迁移不会报错', () => {
  const db = openDatabase(':memory:');

  expect(() => runMigrations(db)).not.toThrow();
});

test('同一个时段不能被确认两次', () => {
  const db = openDatabase(':memory:');
  db.prepare(INSERT_OWNER).run();
  const insert = db.prepare(INSERT_BOOKING);
  insert.run('b1');

  expect(() => insert.run('b2')).toThrow(/UNIQUE/i);
});

test('取消之后同一个时段可以重新被预约', () => {
  const db = openDatabase(':memory:');
  db.prepare(INSERT_OWNER).run();
  const insert = db.prepare(INSERT_BOOKING);
  insert.run('b1');
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = 'b1'").run();

  expect(() => insert.run('b2')).not.toThrow();
});

test('移除 owner 时级联清掉他的预约（外键已开启）', () => {
  const db = openDatabase(':memory:');
  db.prepare(INSERT_OWNER).run();
  db.prepare(INSERT_BOOKING).run('b1');

  db.prepare("DELETE FROM owners WHERE id = 'me'").run();

  expect(db.prepare('SELECT COUNT(*) AS n FROM bookings').get()).toEqual({ n: 0 });
});

test('数据库文件所在目录不存在时自动创建', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tutor-db-'));
  const file = join(dir, 'nested', 'app.db');

  openDatabase(file);

  expect(existsSync(file)).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});
