import { expect, test } from 'vitest';
import { buildApp } from '../app.js';
import { openDatabase, type Db } from '../db/index.js';
import { createOwner } from '../repo/owners.js';

function seed(): { db: Db; token: string; otherToken: string } {
  const db = openDatabase(':memory:');
  const { token } = createOwner(db, { id: 'xavier', displayName: '我', bio: '有空就聊聊' });
  const other = createOwner(db, { id: 'ielts', displayName: '朋友', bio: '雅思口语对练' });

  const addRule = db.prepare(
    'INSERT INTO availability_rules (owner_id, weekday, start_minute, end_minute) VALUES (?, ?, ?, ?)',
  );
  for (let weekday = 0; weekday < 7; weekday++) addRule.run('xavier', weekday, 9 * 60, 21 * 60);

  return { db, token, otherToken: other.token };
}

async function appWith(db: Db) {
  const app = buildApp({ db, bookingRateLimit: { max: 1000, timeWindow: '10 minutes' } });
  await app.ready();
  return app;
}

type App = Awaited<ReturnType<typeof appWith>>;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

interface Day {
  date: string;
  slots: { startUtc: string; label: string; state: string }[];
}

async function publicDays(app: App): Promise<Day[]> {
  const res = await app.inject({ method: 'GET', url: '/api/owners/xavier/slots' });
  return res.json().days as Day[];
}

test('管理接口不带 token → 401', async () => {
  const app = await appWith(seed().db);

  for (const url of ['/api/admin/me', '/api/admin/bookings']) {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode, url).toBe(401);
  }
  const put = await app.inject({ method: 'PUT', url: '/api/admin/rules', payload: { rules: [] } });
  expect(put.statusCode).toBe(401);
});

test('token 不对 → 401', async () => {
  const app = await appWith(seed().db);

  const res = await app.inject({ method: 'GET', url: '/api/admin/me', headers: auth('伪造的token') });

  expect(res.statusCode).toBe(401);
});

test('Authorization 头格式不对（少了 Bearer）→ 401', async () => {
  const { db, token } = seed();
  const app = await appWith(db);

  const res = await app.inject({ method: 'GET', url: '/api/admin/me', headers: { authorization: token } });

  expect(res.statusCode).toBe(401);
});

test('GET /api/admin/me 告诉我是谁、我的设置、我的模板', async () => {
  const { db, token } = seed();
  const app = await appWith(db);

  const res = await app.inject({ method: 'GET', url: '/api/admin/me', headers: auth(token) });

  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.owner).toMatchObject({ id: 'xavier', displayName: '我', slotMinutes: 30, horizonWeeks: 4 });
  expect(body.rules).toHaveLength(7);
  expect(body.rules[0]).toMatchObject({ id: expect.any(Number), weekday: 0, startMinute: 540, endMinute: 1260 });
  expect(body.overrides).toEqual([]);
});

test('PUT /api/admin/rules 整份替换模板，公开页立刻反映', async () => {
  const { db, token } = seed();
  const app = await appWith(db);

  const res = await app.inject({
    method: 'PUT',
    url: '/api/admin/rules',
    headers: auth(token),
    payload: { rules: [{ weekday: 1, startMinute: 10 * 60, endMinute: 11 * 60 }] },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json().rules).toEqual([{ id: expect.any(Number), weekday: 1, startMinute: 600, endMinute: 660 }]);

  const labels = new Set((await publicDays(app)).flatMap((d) => d.slots).map((s) => s.label));
  expect([...labels].sort()).toEqual(['10:00', '10:30']);
});

test('模板里结束时间不晚于开始时间 → 400，原模板不动', async () => {
  const { db, token } = seed();
  const app = await appWith(db);

  const res = await app.inject({
    method: 'PUT',
    url: '/api/admin/rules',
    headers: auth(token),
    payload: { rules: [{ weekday: 1, startMinute: 660, endMinute: 600 }] },
  });

  expect(res.statusCode).toBe(400);
  expect(db.prepare("SELECT count(*) AS n FROM availability_rules WHERE owner_id = 'xavier'").get()).toEqual({ n: 7 });
});

test('weekday 超出 0-6 → 400', async () => {
  const { db, token } = seed();
  const app = await appWith(db);

  const res = await app.inject({
    method: 'PUT',
    url: '/api/admin/rules',
    headers: auth(token),
    payload: { rules: [{ weekday: 9, startMinute: 600, endMinute: 660 }] },
  });

  expect(res.statusCode).toBe(400);
});

test('POST /api/admin/overrides 用 block 挖掉某天，那天从公开页消失', async () => {
  const { db, token } = seed();
  const app = await appWith(db);
  const target = (await publicDays(app))[3]!.date;

  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/overrides',
    headers: auth(token),
    payload: { date: target, kind: 'block', startMinute: 0, endMinute: 1440 },
  });

  expect(res.statusCode).toBe(201);
  expect(res.json()).toMatchObject({ id: expect.any(Number) });
  expect((await publicDays(app)).map((d) => d.date)).not.toContain(target);
});

test('DELETE /api/admin/overrides/:id 撤销调整，那天回来', async () => {
  const { db, token } = seed();
  const app = await appWith(db);
  const target = (await publicDays(app))[3]!.date;
  const created = await app.inject({
    method: 'POST',
    url: '/api/admin/overrides',
    headers: auth(token),
    payload: { date: target, kind: 'block', startMinute: 0, endMinute: 1440 },
  });
  const id = created.json().id as number;

  const res = await app.inject({ method: 'DELETE', url: `/api/admin/overrides/${id}`, headers: auth(token) });

  expect(res.statusCode).toBe(204);
  expect((await publicDays(app)).map((d) => d.date)).toContain(target);
});

test('删不属于自己的调整 → 404', async () => {
  const { db, token, otherToken } = seed();
  const app = await appWith(db);
  const target = (await publicDays(app))[3]!.date;
  const created = await app.inject({
    method: 'POST',
    url: '/api/admin/overrides',
    headers: auth(token),
    payload: { date: target, kind: 'block', startMinute: 0, endMinute: 1440 },
  });
  const id = created.json().id as number;

  const res = await app.inject({ method: 'DELETE', url: `/api/admin/overrides/${id}`, headers: auth(otherToken) });

  expect(res.statusCode).toBe(404);
  expect(db.prepare('SELECT count(*) AS n FROM availability_overrides').get()).toEqual({ n: 1 });
});

test('PATCH /api/admin/settings 改名字和时段长度，公开页立刻反映', async () => {
  const { db, token } = seed();
  const app = await appWith(db);
  await app.inject({
    method: 'PUT',
    url: '/api/admin/rules',
    headers: auth(token),
    payload: { rules: [{ weekday: 1, startMinute: 10 * 60, endMinute: 11 * 60 }] },
  });

  const res = await app.inject({
    method: 'PATCH',
    url: '/api/admin/settings',
    headers: auth(token),
    payload: { displayName: 'Xavier', bio: '随便聊聊', slotMinutes: 60 },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ displayName: 'Xavier', bio: '随便聊聊', slotMinutes: 60 });
  const labels = new Set((await publicDays(app)).flatMap((d) => d.slots).map((s) => s.label));
  expect([...labels]).toEqual(['10:00']);
});

test('设置值超出合理范围 → 400', async () => {
  const { db, token } = seed();
  const app = await appWith(db);

  for (const payload of [{ slotMinutes: 0 }, { horizonWeeks: 99 }, { minNoticeHours: -1 }, { displayName: '长'.repeat(41) }]) {
    const res = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: auth(token), payload });
    expect(res.statusCode, JSON.stringify(payload)).toBe(400);
  }
  expect(db.prepare("SELECT slot_minutes FROM owners WHERE id = 'xavier'").get()).toEqual({ slot_minutes: 30 });
});

test('GET /api/admin/bookings 看到别人填的姓名、联系方式和原因', async () => {
  const { db, token } = seed();
  const app = await appWith(db);
  const slot = (await publicDays(app)).flatMap((d) => d.slots).find((s) => s.state === 'free')!;
  await app.inject({
    method: 'POST',
    url: '/api/owners/xavier/bookings',
    payload: { startUtc: slot.startUtc, name: '小明', contact: 'wx: xiaoming', reason: '练口语' },
  });

  const res = await app.inject({ method: 'GET', url: '/api/admin/bookings', headers: auth(token) });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual([
    {
      id: expect.any(String),
      startUtc: slot.startUtc,
      endUtc: expect.any(String),
      name: '小明',
      contact: 'wx: xiaoming',
      reason: '练口语',
      status: 'confirmed',
      createdAt: expect.any(String),
    },
  ]);
});

test('看不到别人的预约', async () => {
  const { db, token, otherToken } = seed();
  const app = await appWith(db);
  const slot = (await publicDays(app)).flatMap((d) => d.slots).find((s) => s.state === 'free')!;
  await app.inject({
    method: 'POST',
    url: '/api/owners/xavier/bookings',
    payload: { startUtc: slot.startUtc, name: '小明', contact: 'wx', reason: '练口语' },
  });

  expect((await app.inject({ method: 'GET', url: '/api/admin/bookings', headers: auth(otherToken) })).json()).toEqual([]);
  expect((await app.inject({ method: 'GET', url: '/api/admin/bookings', headers: auth(token) })).json()).toHaveLength(1);
});

test('取消预约后，该时段在公开页重新变成可约', async () => {
  const { db, token } = seed();
  const app = await appWith(db);
  const slot = (await publicDays(app)).flatMap((d) => d.slots).find((s) => s.state === 'free')!;
  const created = await app.inject({
    method: 'POST',
    url: '/api/owners/xavier/bookings',
    payload: { startUtc: slot.startUtc, name: '小明', contact: 'wx', reason: '练口语' },
  });
  const id = created.json().id as string;

  const res = await app.inject({ method: 'POST', url: `/api/admin/bookings/${id}/cancel`, headers: auth(token) });

  expect(res.statusCode).toBe(204);
  const after = (await publicDays(app)).flatMap((d) => d.slots).find((s) => s.startUtc === slot.startUtc);
  expect(after?.state).toBe('free');
});

test('取消之后同一个时段可以被重新约上', async () => {
  const { db, token } = seed();
  const app = await appWith(db);
  const slot = (await publicDays(app)).flatMap((d) => d.slots).find((s) => s.state === 'free')!;
  const created = await app.inject({
    method: 'POST',
    url: '/api/owners/xavier/bookings',
    payload: { startUtc: slot.startUtc, name: '小明', contact: 'wx', reason: '练口语' },
  });
  await app.inject({
    method: 'POST',
    url: `/api/admin/bookings/${created.json().id}/cancel`,
    headers: auth(token),
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/owners/xavier/bookings',
    payload: { startUtc: slot.startUtc, name: '小红', contact: 'wx2', reason: '换我来' },
  });

  expect(res.statusCode).toBe(201);
});

test('取消不属于自己的预约 → 404', async () => {
  const { db, token, otherToken } = seed();
  const app = await appWith(db);
  const slot = (await publicDays(app)).flatMap((d) => d.slots).find((s) => s.state === 'free')!;
  const created = await app.inject({
    method: 'POST',
    url: '/api/owners/xavier/bookings',
    payload: { startUtc: slot.startUtc, name: '小明', contact: 'wx', reason: '练口语' },
  });

  const res = await app.inject({
    method: 'POST',
    url: `/api/admin/bookings/${created.json().id}/cancel`,
    headers: auth(otherToken),
  });

  expect(res.statusCode).toBe(404);
  expect(db.prepare("SELECT status FROM bookings").get()).toEqual({ status: 'confirmed' });
});
