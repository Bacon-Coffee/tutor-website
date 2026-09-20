CREATE TABLE owners (
  id               TEXT PRIMARY KEY,
  display_name     TEXT    NOT NULL,
  bio              TEXT    NOT NULL DEFAULT '',
  timezone         TEXT    NOT NULL DEFAULT 'Asia/Shanghai',
  slot_minutes     INTEGER NOT NULL DEFAULT 30,
  horizon_weeks    INTEGER NOT NULL DEFAULT 4,
  min_notice_hours INTEGER NOT NULL DEFAULT 2,
  admin_token_hash TEXT    NOT NULL,
  created_at       TEXT    NOT NULL
);

CREATE TABLE availability_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     TEXT    NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute INTEGER NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
  end_minute   INTEGER NOT NULL CHECK (end_minute > 0 AND end_minute <= 1440),
  CHECK (end_minute > start_minute)
);

CREATE TABLE availability_overrides (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     TEXT    NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  date         TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('add', 'block')),
  start_minute INTEGER NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
  end_minute   INTEGER NOT NULL CHECK (end_minute > 0 AND end_minute <= 1440),
  CHECK (end_minute > start_minute)
);

CREATE TABLE bookings (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  start_utc  TEXT NOT NULL,
  end_utc    TEXT NOT NULL,
  name       TEXT NOT NULL,
  contact    TEXT NOT NULL,
  reason     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_rules_owner     ON availability_rules(owner_id, weekday);
CREATE INDEX idx_overrides_owner ON availability_overrides(owner_id, date);
CREATE INDEX idx_bookings_owner  ON bookings(owner_id, start_utc);

-- 同一个人的同一个开始时刻，只允许存在一条已确认的预约。
-- 靠数据库挡住并发下的重复预约，不依赖应用层的先查后写。
CREATE UNIQUE INDEX idx_booking_slot
  ON bookings(owner_id, start_utc) WHERE status = 'confirmed';
