import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDays, calendarTitle, dayKey, midnight, shiftCalendar } from '../public/dates.js';

test('day and week views use Shanghai dates and Monday-to-Sunday weeks', () => {
  const selected = '2027-01-01';
  const day = calendarDays('day', selected);
  const week = calendarDays('week', selected);
  assert.deepEqual(day, [midnight(selected)]);
  assert.deepEqual(week.map(dayKey), [
    '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'
  ]);
  assert.equal(calendarTitle('week', selected, week), '2026 年 12 月 28 日 – 2027 年 1 月 3 日');
  assert.equal(calendarTitle('day', selected, day), '2027 年 1 月 1 日');
  assert.equal(calendarDays('month', selected).length, 42);
});

test('calendar navigation moves by the visible period and clamps month-end dates', () => {
  assert.equal(shiftCalendar('day', '2026-12-31', 1), '2027-01-01');
  assert.equal(shiftCalendar('week', '2027-01-03', -1), '2026-12-27');
  assert.equal(shiftCalendar('month', '2026-01-31', 1), '2026-02-28');
  assert.equal(shiftCalendar('month', '2028-03-31', -1), '2028-02-29');
  assert.equal(shiftCalendar('month', '2026-12-23', 1), '2027-01-23');
});
