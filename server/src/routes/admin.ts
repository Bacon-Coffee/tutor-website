import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import type { AvailabilityRule } from '../domain/slots.js';
import { addOverride, deleteOverride, listOverrides, listRules, replaceRules } from '../repo/availability.js';
import { cancelBooking, listBookings } from '../repo/bookings.js';
import { findOwnerById, findOwnerByToken, updateOwnerSettings, type OwnerRow } from '../repo/owners.js';
import { ownerSettings } from './public.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** 只有通过管理鉴权的请求才有值。 */
    owner?: OwnerRow;
  }
}

export interface AdminRoutesOptions {
  db: Db;
}

const minute = { type: 'integer', minimum: 0, maximum: 1440 } as const;

const rulesBodySchema = {
  type: 'object',
  required: ['rules'],
  additionalProperties: false,
  properties: {
    rules: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        required: ['weekday', 'startMinute', 'endMinute'],
        additionalProperties: false,
        properties: {
          weekday: { type: 'integer', minimum: 0, maximum: 6 },
          startMinute: minute,
          endMinute: minute,
        },
      },
    },
  },
} as const;

const overrideBodySchema = {
  type: 'object',
  required: ['date', 'kind', 'startMinute', 'endMinute'],
  additionalProperties: false,
  properties: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    kind: { type: 'string', enum: ['add', 'block'] },
    startMinute: minute,
    endMinute: minute,
  },
} as const;

const settingsBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    displayName: { type: 'string', minLength: 1, maxLength: 40 },
    bio: { type: 'string', maxLength: 200 },
    slotMinutes: { type: 'integer', minimum: 5, maximum: 240 },
    horizonWeeks: { type: 'integer', minimum: 1, maximum: 12 },
    minNoticeHours: { type: 'integer', minimum: 0, maximum: 168 },
  },
} as const;

/** 鉴权钩子跑过之后才会进 handler，所以这里拿不到人就是我们自己写错了。 */
function ownerOf(req: FastifyRequest): OwnerRow {
  if (!req.owner) throw new Error('管理路由缺少鉴权钩子');
  return req.owner;
}

export const adminRoutes: FastifyPluginAsync<AdminRoutesOptions> = async (app, opts) => {
  const { db } = opts;

  // 这个 hook 只作用在本插件里注册的路由上（Fastify 的封装作用域）
  app.addHook('onRequest', async (req, reply) => {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    const owner = match ? findOwnerByToken(db, match[1]!) : undefined;

    if (!owner) {
      return reply.code(401).send({ error: 'unauthorized', message: '管理链接无效，请用 seed 时拿到的链接' });
    }
    req.owner = owner;
  });

  app.get('/api/admin/me', async (req) => {
    const owner = ownerOf(req);
    return {
      owner: ownerSettings(owner),
      rules: listRules(db, owner.id),
      overrides: listOverrides(db, owner.id),
    };
  });

  app.put<{ Body: { rules: AvailabilityRule[] } }>(
    '/api/admin/rules',
    { schema: { body: rulesBodySchema } },
    async (req, reply) => {
      const owner = ownerOf(req);
      const { rules } = req.body;

      if (rules.some((r) => r.endMinute <= r.startMinute)) {
        return reply.code(400).send({ error: 'invalid_rule', message: '结束时间必须晚于开始时间' });
      }

      replaceRules(db, owner.id, rules);
      return { rules: listRules(db, owner.id) };
    },
  );

  app.post<{ Body: { date: string; kind: 'add' | 'block'; startMinute: number; endMinute: number } }>(
    '/api/admin/overrides',
    { schema: { body: overrideBodySchema } },
    async (req, reply) => {
      const owner = ownerOf(req);
      const override = req.body;

      if (override.endMinute <= override.startMinute) {
        return reply.code(400).send({ error: 'invalid_override', message: '结束时间必须晚于开始时间' });
      }

      return reply.code(201).send({ id: addOverride(db, owner.id, override) });
    },
  );

  app.delete<{ Params: { id: number } }>(
    '/api/admin/overrides/:id',
    { schema: { params: { type: 'object', properties: { id: { type: 'integer' } } } } },
    async (req, reply) => {
      const owner = ownerOf(req);

      if (!deleteOverride(db, owner.id, req.params.id)) {
        return reply.code(404).send({ error: 'override_not_found', message: '没有这条调整' });
      }
      return reply.code(204).send();
    },
  );

  app.patch('/api/admin/settings', { schema: { body: settingsBodySchema } }, async (req) => {
    const owner = ownerOf(req);
    updateOwnerSettings(db, owner.id, req.body as Record<string, never>);

    return ownerSettings(findOwnerById(db, owner.id)!);
  });

  app.get('/api/admin/bookings', async (req) => {
    const owner = ownerOf(req);
    return listBookings(db, owner.id).map((b) => ({
      id: b.id,
      startUtc: b.start_utc,
      endUtc: b.end_utc,
      name: b.name,
      contact: b.contact,
      reason: b.reason,
      status: b.status,
      createdAt: b.created_at,
    }));
  });

  app.post<{ Params: { id: string } }>('/api/admin/bookings/:id/cancel', async (req, reply) => {
    const owner = ownerOf(req);

    if (!cancelBooking(db, owner.id, req.params.id)) {
      return reply.code(404).send({ error: 'booking_not_found', message: '没有这条预约，或者已经取消过了' });
    }
    return reply.code(204).send();
  });
};
