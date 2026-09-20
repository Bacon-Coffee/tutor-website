import { fromZonedTime } from 'date-fns-tz';
import { expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { openDatabase, type Db } from '../db/index.js';
import { createOwner } from '../repo/owners.js';

/** 两个人，其中 xavier 每天 09:00-21:00 都有空，保证任何时刻跑测试都排得出空闲时段。 */
function seed(): Db {
  const db = openDatabase(':memory:');
  createOwner(db, { id: 'xavier', displayName: '我', bio: '有空就聊聊' });
  createOwner(db, { id: 'ielts', displayName: '朋友', bio: '雅思口语对练' });

  const addRule = db.prepare(
    'INSERT INTO availability_rules (owner_id, weekday, start_minute, end_minute) VALUES (?, ?, ?, ?)',
  );
  for (let weekday = 0; weekday < 7; weekday++) addRule.run('xavier', weekday, 9 * 60, 21 * 60);

  return db;
}

/** 测试里默认把限流放宽，只有专门测限流的用例才收紧。 */
async function appWith(db: Db, bookingRateLimit = { max: 1000, timeWindow: '10 minutes' }) {
  const app = buildApp({ db, bookingRateLimit });
  await app.ready();
  return app;
}

const booking = { name: '小明', contact: 'wx: xiaoming', reason: '想练雅思口语 part 2' };

async function firstFreeSlot(app: Awaited<ReturnType<typeof appWith>>) {
  const res = await app.inject({ method: 'GET', url: '/api/owners/xavier/slots' });
  const days = res.json().days as { date: string; slots: { startUtc: string; state: string }[] }[];
  const slot = days.flatMap((d) => d.slots).find((s) => s.state === 'free');
  if (!slot) throw new Error('测试数据没排出空闲时段');
  return { slot, date: days[0]!.date };
}

test('GET /api/owners 列出所有人', async () => {
  const app = await appWith(seed());

  const res = await app.inject({ method: 'GET', url: '/api/owners' });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual([
    { id: 'xavier', displayName: '我', bio: '有空就聊聊' },
    { id: 'ielts', displayName: '朋友', bio: '雅思口语对练' },
  ]);
});

test('GET /api/owners/:slug/slots 返回这个人的设置和按天分组的时段', async () => {
  const app = await appWith(seed());

  const res = await app.inject({ method: 'GET', url: '/api/owners/xavier/slots' });

  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.owner).toMatchObject({ id: 'xavier', displayName: '我', timezone: 'Asia/Shanghai', slotMinutes: 30 });
  expect(body.days.length).toBeGreaterThan(0);
  expect(body.days[0].slots[0]).toMatchObject({
    startUtc: expect.any(String),
    endUtc: expect.any(String),
    label: expect.stringMatching(/^\d\d:\d\d$/),
    state: expect.stringMatching(/^(free|booked|too-soon)$/),
  });
});

test('查一个不存在的人 → 404', async () => {
  const app = await appWith(seed());

  const res = await app.inject({ method: 'GET', url: '/api/owners/查无此人/slots' });

  expect(res.statusCode).toBe(404);
});

test('预约一个空闲时段 → 201，并且落库', async () => {
  const db = seed();
  const app = await appWith(db);
  const { slot } = await firstFreeSlot(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/owners/xavier/bookings',
    payload: { startUtc: slot.startUtc, ...booking },
  });

  expect(res.statusCode).toBe(201);
  expect(res.json()).toMatchObject({ id: expect.any(String), startUtc: slot.startUtc });
  const row = db.prepare('SELECT * FROM bookings WHERE owner_id = ?').get('xavier') as Record<string, unknown>;
  expect(row).toMatchObject({ start_utc: slot.startUtc, name: '小明', reason: '想练雅思口语 part 2', status: 'confirmed' });
});

test('约过的时段在 slots 里变成 booked', async () => {
  const app = await appWith(seed());
  const { slot } = await firstFreeSlot(app);
  await app.inject({ method: 'POST', url: '/api/owners/xavier/bookings', payload: { startUtc: slot.startUtc, ...booking } });

  const res = await app.inject({ method: 'GET', url: '/api/owners/xavier/slots' });

  const all = (res.json().days as { slots: { startUtc: string; state: string }[] }[]).flatMap((d) => d.slots);
  expect(all.find((s) => s.startUtc === slot.startUtc)?.state).toBe('booked');
});

test('同一个时段被约第二次 → 409', async () => {
  const db = seed();
  const app = await appWith(db);
  const { slot } = await firstFreeSlot(app);
  await app.inject({ method: 'POST', url: '/api/owners/xavier/bookings', payload: { startUtc: slot.startUtc, ...booking } });

  const res = await app.inject({
    method: 'POST',
    url: '/api/owners/xavier/bookings',
    payload: { startUtc: slot.startUtc, name: '小红', contact: 'wx: xiaohong', reason: '插队试试' },
  });

  expect(res.statusCode).toBe(409);
  expect(db.prepare('SELECT count(*) AS n FROM bookings').get()).toEqual({ n: 1 });
});

test('约一个不在空闲范围内的时间（凌晨三点）→ 409', async () => {
  const db = seed();
  const app = await appWith(db);
  const { date } = await firstFreeSlot(app);
  const midnightish = fromZonedTime(`${date}T03:00:00`, 'Asia/Shanghai').toISOString();

  const res = await app.inject({
    method: 'POST',
    url: '/api/owners/xavier/bookings',
    payload: { startUtc: midnightish, ...booking },
  });

  expect(res.statusCode).toBe(409);
  expect(db.prepare('SELECT count(*) AS n FROM bookings').get()).toEqual({ n: 0 });
});

test('姓名超过 40 字 → 400，不落库', async () => {
  const db = seed();
  const app = await appWith(db);
  const { slot } = await firstFreeSlot(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/owners/xavier/bookings',
    payload: { startUtc: slot.startUtc, ...booking, name: '长'.repeat(41) },
  });

  expect(res.statusCode).toBe(400);
  expect(db.prepare('SELECT count(*) AS n FROM bookings').get()).toEqual({ n: 0 });
});

test('预约原因超过 500 字 → 400', async () => {
  const app = await appWith(seed());
  const { slot } = await firstFreeSlot(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/owners/xavier/bookings',
    payload: { startUtc: slot.startUtc, ...booking, reason: '啰'.repeat(501) },
  });

  expect(res.statusCode).toBe(400);
});

test('少填必填字段 → 400', async () => {
  const app = await appWith(seed());
  const { slot } = await firstFreeSlot(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/owners/xavier/bookings',
    payload: { startUtc: slot.startUtc, name: '小明', contact: 'wx' },
  });

  expect(res.statusCode).toBe(400);
});

test('填了蜜罐字段（真人看不见的输入框）→ 400，不落库', async () => {
  const db = seed();
  const app = await appWith(db);
  const { slot } = await firstFreeSlot(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/owners/xavier/bookings',
    payload: { startUtc: slot.startUtc, ...booking, website: 'http://spam.example.com' },
  });

  expect(res.statusCode).toBe(400);
  expect(db.prepare('SELECT count(*) AS n FROM bookings').get()).toEqual({ n: 0 });
});

test('给不存在的人预约 → 404', async () => {
  const app = await appWith(seed());
  const { slot } = await firstFreeSlot(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/owners/查无此人/bookings',
    payload: { startUtc: slot.startUtc, ...booking },
  });

  expect(res.statusCode).toBe(404);
});

test('同一 IP 10 分钟内第 4 次预约 → 429', async () => {
  const app = await appWith(seed(), { max: 3, timeWindow: '10 minutes' });
  const res = await app.inject({ method: 'GET', url: '/api/owners/xavier/slots' });
  const free = (res.json().days as { slots: { startUtc: string; state: string }[] }[])
    .flatMap((d) => d.slots)
    .filter((s) => s.state === 'free')
    .slice(0, 4);
  expect(free).toHaveLength(4);

  const codes: number[] = [];
  for (const slot of free) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/owners/xavier/bookings',
      payload: { startUtc: slot.startUtc, ...booking },
    });
    codes.push(r.statusCode);
  }

  expect(codes).toEqual([201, 201, 201, 429]);
});
