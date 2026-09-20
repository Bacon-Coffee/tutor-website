import { expect, test } from 'vitest';
import { generateSlots, type GenerateSlotsInput } from './slots.js';

const TZ = 'Asia/Shanghai';
/** 2026-09-21 周一 10:00（北京时间） */
const MON_10AM = new Date('2026-09-21T02:00:00Z');

const base: GenerateSlotsInput = {
  rules: [],
  overrides: [],
  bookings: [],
  timezone: TZ,
  slotMinutes: 30,
  minNoticeHours: 2,
  horizonWeeks: 1,
  now: MON_10AM,
};

const at = (h: number, m = 0) => h * 60 + m;

test('每周模板在对应星期生成等长时段', () => {
  const days = generateSlots({
    ...base,
    rules: [{ weekday: 2, startMinute: at(19), endMinute: at(20) }],
  });

  expect(days).toEqual([
    {
      date: '2026-09-22',
      weekdayLabel: '周二',
      slots: [
        {
          startUtc: '2026-09-22T11:00:00.000Z',
          endUtc: '2026-09-22T11:30:00.000Z',
          label: '19:00',
          state: 'free',
        },
        {
          startUtc: '2026-09-22T11:30:00.000Z',
          endUtc: '2026-09-22T12:00:00.000Z',
          label: '19:30',
          state: 'free',
        },
      ],
    },
  ]);
});

test('block 划掉模板中间一段，两边的时段保留', () => {
  const days = generateSlots({
    ...base,
    rules: [{ weekday: 2, startMinute: at(19), endMinute: at(21) }],
    overrides: [
      { date: '2026-09-22', kind: 'block', startMinute: at(19, 30), endMinute: at(20) },
    ],
  });

  expect(days[0]!.slots.map((s) => s.label)).toEqual(['19:00', '20:00', '20:30']);
});

test('add 能在没有模板的一天新增时段', () => {
  const days = generateSlots({
    ...base,
    rules: [],
    overrides: [
      { date: '2026-09-23', kind: 'add', startMinute: at(9), endMinute: at(10) },
    ],
  });

  expect(days).toHaveLength(1);
  expect(days[0]!.date).toBe('2026-09-23');
  expect(days[0]!.weekdayLabel).toBe('周三');
  expect(days[0]!.slots.map((s) => s.label)).toEqual(['09:00', '09:30']);
});

test('已确认的预约让对应时段变成 booked', () => {
  const days = generateSlots({
    ...base,
    rules: [{ weekday: 2, startMinute: at(19), endMinute: at(20) }],
    bookings: [{ startUtc: '2026-09-22T11:00:00.000Z' }],
  });

  expect(days[0]!.slots.map((s) => [s.label, s.state])).toEqual([
    ['19:00', 'booked'],
    ['19:30', 'free'],
  ]);
});

test('已经开始的时段不出现在结果里', () => {
  const days = generateSlots({
    ...base,
    slotMinutes: 60,
    minNoticeHours: 0,
    rules: [{ weekday: 1, startMinute: at(8), endMinute: at(11) }],
  });

  expect(days[0]!.slots.map((s) => s.label)).toEqual(['10:00']);
});

test('最少提前时间之内的时段标记为 too-soon', () => {
  const days = generateSlots({
    ...base,
    slotMinutes: 60,
    minNoticeHours: 2,
    rules: [{ weekday: 1, startMinute: at(10), endMinute: at(13) }],
  });

  expect(days[0]!.slots.map((s) => [s.label, s.state])).toEqual([
    ['10:00', 'too-soon'],
    ['11:00', 'too-soon'],
    ['12:00', 'free'],
  ]);
});

// —— 以下为回归护栏：覆盖最小实现阶段已具备的行为，防止后续改动打破 ——

test('模板按周重复，一直排到 horizonWeeks 末尾', () => {
  const days = generateSlots({
    ...base,
    horizonWeeks: 3,
    rules: [{ weekday: 2, startMinute: at(19), endMinute: at(19, 30) }],
  });

  expect(days.map((d) => d.date)).toEqual(['2026-09-22', '2026-09-29', '2026-10-06']);
});

test('区间不能被时段长度整除时，末尾不足一段的部分丢弃', () => {
  const days = generateSlots({
    ...base,
    rules: [{ weekday: 2, startMinute: at(19), endMinute: at(20, 20) }],
  });

  expect(days[0]!.slots.map((s) => s.label)).toEqual(['19:00', '19:30']);
});

test('临近午夜的时段换算成 UTC 时跨到前一天', () => {
  const days = generateSlots({
    ...base,
    rules: [{ weekday: 3, startMinute: at(23), endMinute: at(24) }],
  });

  expect(days[0]!.slots).toEqual([
    {
      startUtc: '2026-09-23T15:00:00.000Z',
      endUtc: '2026-09-23T15:30:00.000Z',
      label: '23:00',
      state: 'free',
    },
    {
      startUtc: '2026-09-23T15:30:00.000Z',
      endUtc: '2026-09-23T16:00:00.000Z',
      label: '23:30',
      state: 'free',
    },
  ]);
});
