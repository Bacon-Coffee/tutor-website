import type { Db } from '../db/index.js';
import type { AvailabilityOverride, AvailabilityRule } from '../domain/slots.js';

export interface StoredRule extends AvailabilityRule {
  id: number;
}

export interface StoredOverride extends AvailabilityOverride {
  id: number;
}

interface RuleRow {
  id: number;
  weekday: number;
  start_minute: number;
  end_minute: number;
}

interface OverrideRow {
  id: number;
  date: string;
  kind: 'add' | 'block';
  start_minute: number;
  end_minute: number;
}

export function listRules(db: Db, ownerId: string): StoredRule[] {
  const rows = db
    .prepare(
      'SELECT id, weekday, start_minute, end_minute FROM availability_rules WHERE owner_id = ? ORDER BY weekday, start_minute',
    )
    .all(ownerId) as RuleRow[];

  return rows.map((r) => ({
    id: r.id,
    weekday: r.weekday,
    startMinute: r.start_minute,
    endMinute: r.end_minute,
  }));
}

export function listOverrides(db: Db, ownerId: string): StoredOverride[] {
  const rows = db
    .prepare(
      'SELECT id, date, kind, start_minute, end_minute FROM availability_overrides WHERE owner_id = ? ORDER BY date, start_minute',
    )
    .all(ownerId) as OverrideRow[];

  return rows.map((o) => ({
    id: o.id,
    date: o.date,
    kind: o.kind,
    startMinute: o.start_minute,
    endMinute: o.end_minute,
  }));
}

/** 整份替换每周模板：后台是「一次提交整张表」的交互，删旧写新放在一个事务里。 */
export function replaceRules(db: Db, ownerId: string, rules: AvailabilityRule[]): void {
  const remove = db.prepare('DELETE FROM availability_rules WHERE owner_id = ?');
  const add = db.prepare(
    'INSERT INTO availability_rules (owner_id, weekday, start_minute, end_minute) VALUES (?, ?, ?, ?)',
  );

  db.transaction(() => {
    remove.run(ownerId);
    for (const rule of rules) add.run(ownerId, rule.weekday, rule.startMinute, rule.endMinute);
  })();
}

export function addOverride(db: Db, ownerId: string, override: AvailabilityOverride): number {
  const result = db
    .prepare(
      'INSERT INTO availability_overrides (owner_id, date, kind, start_minute, end_minute) VALUES (?, ?, ?, ?, ?)',
    )
    .run(ownerId, override.date, override.kind, override.startMinute, override.endMinute);

  return Number(result.lastInsertRowid);
}

/** 带上 owner_id，别人的调整删不掉。返回 false 表示没这条或不是自己的。 */
export function deleteOverride(db: Db, ownerId: string, id: number): boolean {
  const result = db
    .prepare('DELETE FROM availability_overrides WHERE id = ? AND owner_id = ?')
    .run(id, ownerId);

  return result.changes > 0;
}
