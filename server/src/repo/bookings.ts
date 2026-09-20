import type { Db } from '../db/index.js';

export interface BookingRow {
  id: string;
  owner_id: string;
  start_utc: string;
  end_utc: string;
  name: string;
  contact: string;
  reason: string;
  status: 'confirmed' | 'cancelled';
  created_at: string;
}

export interface NewBooking {
  id: string;
  ownerId: string;
  startUtc: string;
  endUtc: string;
  name: string;
  contact: string;
  reason: string;
}

/** 排期只关心「还没发生的已确认预约」，过去的记录不影响未来时段。 */
export function listConfirmedBookings(db: Db, ownerId: string, fromUtc: string): { startUtc: string }[] {
  const rows = db
    .prepare(
      "SELECT start_utc FROM bookings WHERE owner_id = ? AND status = 'confirmed' AND start_utc >= ?",
    )
    .all(ownerId, fromUtc) as { start_utc: string }[];

  return rows.map((r) => ({ startUtc: r.start_utc }));
}

/**
 * 写入一条预约。返回 false 表示这个时段刚刚被别人约走了——
 * 靠 idx_booking_slot 这个唯一索引判断，不做「先查再写」，所以并发也挡得住。
 */
export function insertBooking(db: Db, booking: NewBooking): boolean {
  try {
    db.prepare(
      `INSERT INTO bookings (id, owner_id, start_utc, end_utc, name, contact, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      booking.id,
      booking.ownerId,
      booking.startUtc,
      booking.endUtc,
      booking.name,
      booking.contact,
      booking.reason,
      new Date().toISOString(),
    );
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') return false;
    throw error;
  }
}

/** 管理页的预约记录，最近的排在前面。 */
export function listBookings(db: Db, ownerId: string): BookingRow[] {
  return db
    .prepare('SELECT * FROM bookings WHERE owner_id = ? ORDER BY start_utc DESC')
    .all(ownerId) as BookingRow[];
}

/** 带上 owner_id，别人的预约取消不了。取消后时段自动回到可约状态（唯一索引只约束 confirmed）。 */
export function cancelBooking(db: Db, ownerId: string, id: string): boolean {
  const result = db
    .prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND owner_id = ? AND status = 'confirmed'")
    .run(id, ownerId);

  return result.changes > 0;
}
