import { createAdminToken, hashToken } from '../auth.js';
import type { Db } from '../db/index.js';

export interface OwnerRow {
  id: string;
  display_name: string;
  bio: string;
  timezone: string;
  slot_minutes: number;
  horizon_weeks: number;
  min_notice_hours: number;
  admin_token_hash: string;
  created_at: string;
}

export interface CreateOwnerInput {
  id: string;
  displayName: string;
  bio?: string;
  timezone?: string;
  slotMinutes?: number;
  horizonWeeks?: number;
  minNoticeHours?: number;
}

/** 建一个人，返回只在此刻出现一次的明文 token（用来拼管理链接）。 */
export function createOwner(db: Db, input: CreateOwnerInput): { id: string; token: string } {
  const token = createAdminToken();

  const columns = ['id', 'display_name', 'admin_token_hash', 'created_at'];
  const values: unknown[] = [input.id, input.displayName, hashToken(token), new Date().toISOString()];

  const optional: Record<string, unknown> = {
    bio: input.bio,
    timezone: input.timezone,
    slot_minutes: input.slotMinutes,
    horizon_weeks: input.horizonWeeks,
    min_notice_hours: input.minNoticeHours,
  };
  for (const [column, value] of Object.entries(optional)) {
    if (value === undefined) continue;
    columns.push(column);
    values.push(value);
  }

  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(`INSERT INTO owners (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);

  return { id: input.id, token };
}

export function findOwnerByToken(db: Db, token: string): OwnerRow | undefined {
  return db.prepare('SELECT * FROM owners WHERE admin_token_hash = ?').get(hashToken(token)) as
    | OwnerRow
    | undefined;
}

/** 管理链接泄露时换一条：旧 token 立刻失效。 */
export function rotateAdminToken(db: Db, ownerId: string): string {
  const token = createAdminToken();
  const result = db
    .prepare('UPDATE owners SET admin_token_hash = ? WHERE id = ?')
    .run(hashToken(token), ownerId);

  if (result.changes === 0) throw new Error(`没有找到 owner: ${ownerId}`);
  return token;
}

/** 首页用：按创建顺序列出所有人。 */
export function listOwners(db: Db): OwnerRow[] {
  return db.prepare('SELECT * FROM owners ORDER BY rowid').all() as OwnerRow[];
}

export function findOwnerById(db: Db, id: string): OwnerRow | undefined {
  return db.prepare('SELECT * FROM owners WHERE id = ?').get(id) as OwnerRow | undefined;
}

export interface OwnerSettingsPatch {
  displayName?: string;
  bio?: string;
  slotMinutes?: number;
  horizonWeeks?: number;
  minNoticeHours?: number;
}

/** 只更新传了的字段。全都没传就什么也不做。 */
export function updateOwnerSettings(db: Db, ownerId: string, patch: OwnerSettingsPatch): void {
  const columns: Record<string, unknown> = {
    display_name: patch.displayName,
    bio: patch.bio,
    slot_minutes: patch.slotMinutes,
    horizon_weeks: patch.horizonWeeks,
    min_notice_hours: patch.minNoticeHours,
  };

  const entries = Object.entries(columns).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;

  const assignments = entries.map(([column]) => `${column} = ?`).join(', ');
  db.prepare(`UPDATE owners SET ${assignments} WHERE id = ?`).run(...entries.map(([, v]) => v), ownerId);
}
