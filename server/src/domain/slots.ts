import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

/** 每周固定模板的一条规则。weekday: 0=周日 .. 6=周六，分钟数从当天 00:00 起算（本地时区）。 */
export interface AvailabilityRule {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/** 某一天的临时调整：add 增加一段，block 划掉一段。 */
export interface AvailabilityOverride {
  date: string;
  kind: 'add' | 'block';
  startMinute: number;
  endMinute: number;
}

export interface BookedSlot {
  startUtc: string;
}

export type SlotState = 'free' | 'booked' | 'too-soon';

export interface Slot {
  startUtc: string;
  endUtc: string;
  label: string;
  state: SlotState;
}

export interface DaySlots {
  date: string;
  weekdayLabel: string;
  slots: Slot[];
}

export interface GenerateSlotsInput {
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
  bookings: BookedSlot[];
  timezone: string;
  slotMinutes: number;
  minNoticeHours: number;
  horizonWeeks: number;
  now: Date;
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const pad = (n: number) => String(n).padStart(2, '0');

/** 把「当天 00:00 起的分钟数」格式化成 HH:mm。 */
function minuteLabel(minute: number): string {
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** 日期字符串 'YYYY-MM-DD' 对应星期几（0=周日）。纯日历运算，与时区无关。 */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 某本地日期的第 N 分钟，对应的真实时刻。 */
function instantAt(date: string, minute: number, timezone: string): Date {
  return fromZonedTime(`${date}T${minuteLabel(minute)}:00`, timezone);
}

interface Interval {
  startMinute: number;
  endMinute: number;
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

export function generateSlots(input: GenerateSlotsInput): DaySlots[] {
  const {
    rules,
    overrides,
    bookings,
    timezone,
    slotMinutes,
    minNoticeHours,
    horizonWeeks,
    now,
  } = input;

  const bookedStarts = new Set(bookings.map((b) => new Date(b.startUtc).toISOString()));
  const noticeCutoff = now.getTime() + minNoticeHours * 60 * 60_000;

  const firstDate = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const days: DaySlots[] = [];

  for (let offset = 0; offset < horizonWeeks * 7; offset++) {
    const date = addDays(firstDate, offset);
    const weekday = weekdayOf(date);

    const open: Interval[] = [
      ...rules.filter((r) => r.weekday === weekday),
      ...overrides.filter((o) => o.date === date && o.kind === 'add'),
    ];
    const blocked = overrides.filter((o) => o.date === date && o.kind === 'block');

    // 以开始时刻去重：模板和当天新增可能排出同一个时段
    const byStart = new Map<string, Slot>();

    for (const interval of open) {
      for (let m = interval.startMinute; m + slotMinutes <= interval.endMinute; m += slotMinutes) {
        const span: Interval = { startMinute: m, endMinute: m + slotMinutes };
        if (blocked.some((b) => overlaps(span, b))) continue;

        const start = instantAt(date, m, timezone);
        if (start.getTime() < now.getTime()) continue;

        const startUtc = start.toISOString();
        const state: SlotState = bookedStarts.has(startUtc)
          ? 'booked'
          : start.getTime() < noticeCutoff
            ? 'too-soon'
            : 'free';

        byStart.set(startUtc, {
          startUtc,
          endUtc: new Date(start.getTime() + slotMinutes * 60_000).toISOString(),
          label: minuteLabel(m),
          state,
        });
      }
    }

    if (byStart.size > 0) {
      const slots = [...byStart.values()].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
      days.push({ date, weekdayLabel: WEEKDAY_LABELS[weekday]!, slots });
    }
  }

  return days;
}
