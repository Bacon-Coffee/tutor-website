import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { RateLimitOptions } from '../config.js';
import type { Db } from '../db/index.js';
import { generateSlots, type DaySlots } from '../domain/slots.js';
import { listOverrides, listRules } from '../repo/availability.js';
import { insertBooking, listConfirmedBookings } from '../repo/bookings.js';
import { findOwnerById, listOwners, type OwnerRow } from '../repo/owners.js';

export interface PublicRoutesOptions {
  db: Db;
  bookingRateLimit: RateLimitOptions;
}

/** 字段长度上限。公开表单没有登录，只能靠这些硬边界挡住灌水。 */
const bookingBodySchema = {
  type: 'object',
  required: ['startUtc', 'name', 'contact', 'reason'],
  additionalProperties: false,
  properties: {
    startUtc: { type: 'string', minLength: 1, maxLength: 40 },
    name: { type: 'string', minLength: 1, maxLength: 40 },
    contact: { type: 'string', minLength: 1, maxLength: 100 },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    /** 蜜罐：页面上对真人隐藏，只有脚本会填。 */
    website: { type: 'string', maxLength: 200 },
  },
} as const;

interface BookingBody {
  startUtc: string;
  name: string;
  contact: string;
  reason: string;
  website?: string;
}

/** 把用户传来的时间统一成 ISO UTC；格式不对返回 null。 */
function normalizeIso(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function slotsFor(db: Db, owner: OwnerRow, now: Date): DaySlots[] {
  return generateSlots({
    rules: listRules(db, owner.id),
    overrides: listOverrides(db, owner.id),
    bookings: listConfirmedBookings(db, owner.id, now.toISOString()),
    timezone: owner.timezone,
    slotMinutes: owner.slot_minutes,
    minNoticeHours: owner.min_notice_hours,
    horizonWeeks: owner.horizon_weeks,
    now,
  });
}

export function ownerSettings(owner: OwnerRow) {
  return {
    id: owner.id,
    displayName: owner.display_name,
    bio: owner.bio,
    timezone: owner.timezone,
    slotMinutes: owner.slot_minutes,
    horizonWeeks: owner.horizon_weeks,
    minNoticeHours: owner.min_notice_hours,
  };
}

export const publicRoutes: FastifyPluginAsync<PublicRoutesOptions> = async (app, opts) => {
  const { db } = opts;

  app.get('/api/owners', async () =>
    listOwners(db).map((o) => ({ id: o.id, displayName: o.display_name, bio: o.bio })),
  );

  app.get<{ Params: { slug: string } }>('/api/owners/:slug/slots', async (req, reply) => {
    const owner = findOwnerById(db, req.params.slug);
    if (!owner) return reply.code(404).send({ error: 'owner_not_found', message: '没有这个人' });

    return { owner: ownerSettings(owner), days: slotsFor(db, owner, new Date()) };
  });

  app.post<{ Params: { slug: string }; Body: BookingBody }>(
    '/api/owners/:slug/bookings',
    { config: { rateLimit: opts.bookingRateLimit }, schema: { body: bookingBodySchema } },
    async (req, reply) => {
      const body = req.body;

      if (body.website !== undefined && body.website.trim() !== '') {
        return reply.code(400).send({ error: 'invalid_submission', message: '提交被拒绝' });
      }

      const owner = findOwnerById(db, req.params.slug);
      if (!owner) return reply.code(404).send({ error: 'owner_not_found', message: '没有这个人' });

      const startUtc = normalizeIso(body.startUtc);
      if (!startUtc) {
        return reply.code(400).send({ error: 'invalid_start', message: '开始时间格式不对' });
      }

      // 只认排期算出来的、当前确实空闲的时段：既挡住已被约的，也挡住不在空闲范围内的
      const slot = slotsFor(db, owner, new Date())
        .flatMap((day) => day.slots)
        .find((s) => s.startUtc === startUtc);

      if (!slot || slot.state !== 'free') {
        return reply
          .code(409)
          .send({ error: 'slot_unavailable', message: '这个时段已经约不了了，刷新看看别的时间' });
      }

      const id = randomUUID();
      const created = insertBooking(db, {
        id,
        ownerId: owner.id,
        startUtc: slot.startUtc,
        endUtc: slot.endUtc,
        name: body.name,
        contact: body.contact,
        reason: body.reason,
      });

      // 并发：查完到写入之间被人抢先了
      if (!created) {
        return reply
          .code(409)
          .send({ error: 'slot_unavailable', message: '这个时段刚刚被约走了，换一个时间吧' });
      }

      return reply.code(201).send({ id, startUtc: slot.startUtc, endUtc: slot.endUtc });
    },
  );
};
