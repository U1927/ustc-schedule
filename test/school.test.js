import { test } from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { at, dayKey, midnight, monthGrid } from '../public/dates.js';
import { parseCalendar } from '../public/ical-import.js';
import { courseLessons, parseActivity, parseCourses } from '../public/school.js';
import { projectCatalog } from '../server/young.js';

test('Shanghai calendar groups UTC evening in the next day', () => {
  assert.equal(dayKey(Date.parse('2026-11-22T16:30:00Z')), '2026-11-23');
  assert.equal(monthGrid('2026-11-01')[0], midnight('2026-10-26'));
});

test('JW course rows expand period numbers, odd weeks and exact dated lessons', () => {
  const source = { studentTableVm: { lessonIds: [1, 2, 3] }, lessonId2Lesson: {
    1: { id: 1, course: { nameZh: '离散数学' }, dateTimePlacePersonText: { cn: '周一 第1-5周（单） 3-4节 地点：西区101' } },
    2: { id: 2, courseName: '大学物理', scheduleList: [{ date: '2026-09-12', startUnit: 6, endUnit: 7, roomName: '东区 202' }] },
    3: { id: 3, name: '未安排' }
  } };
  const { events, missing } = parseCourses({ kind: 'ustc-courses', lessons: courseLessons(source) }, '2026-09-07');
  assert.equal(missing, 1);
  assert.deepEqual(events.map((row) => row.starts), [
    at('2026-09-07', '09:45'), at('2026-09-12', '14:00'), at('2026-09-21', '09:45'), at('2026-10-05', '09:45')
  ]);
  assert.equal(events[0].ends, at('2026-09-07', '11:20'));
  assert.equal(events[0].place, '西区101');
  assert.throws(() => parseCourses(source, '2026-09-08'), /周一/);
});

test('Young detail uses activity timestamps and strips session query fields', () => {
  const text = '校园音乐会\n报名时间：2026-11-24 09:00~12:00\n活动时间：2026年12月5日 14:00 至 16:00\n活动地点：东区礼堂';
  const parsed = parseActivity(text, 'https://young.ustc.edu.cn/detail?id=1&ticket=hidden');
  assert.equal(parsed.starts, at('2026-12-05', '14:00'));
  assert.equal(parsed.ends, at('2026-12-05', '16:00'));
  assert.equal(parsed.place, '东区礼堂');
  assert.equal(parsed.sourceUrl, 'https://young.ustc.edu.cn/detail?id=1');
  assert.equal(parseActivity({ ...parsed, kind: 'ustc-activity', url: parsed.sourceUrl }).externalId, parsed.externalId);
  assert.throws(() => parseActivity('没有活动时间\n报名时间：2026-11-24 09:00'), /没有识别/);
});

test('compact teaching-unit ranges support excluded weeks and numeric weekdays', () => {
  const lessons = [{ key: '1', title: '实验课', schedule: '第1-3周 2（3，4，5） 除第2周' }];
  const { events } = parseCourses({ kind: 'ustc-courses', lessons }, '2026-09-07');
  assert.deepEqual(events.map((row) => row.starts), [at('2026-09-08', '09:45'), at('2026-09-22', '09:45')]);
  assert.equal(events[0].ends, at('2026-09-08', '12:10'));
});

test('campus mirror response exposes only calendar fields', () => {
  const youngId = 'f'.repeat(32);
  const result = projectCatalog({ data: [
    { youngId, name: '音乐会', location: '礼堂', startAt: '2026-12-05T14:00:00+08:00', contactTel: 'private' },
    { youngId, name: '无日期' }
  ], pagination: { totalPages: 2 } }, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].starts, at('2026-12-05', '14:00'));
  assert.equal(result.items[0].ends, at('2026-12-05', '15:00'));
  assert.equal(result.items[0].externalId, `catalog:${youngId}`);
  assert.equal(result.more, true);
  assert.equal('contactTel' in result.items[0], false);
});

test('ICS recurring courses keep Shanghai wall times and exclude skipped classes', () => {
  const input = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:math-1', 'SUMMARY:线性代数',
    'DTSTART:20260907T095000', 'DTEND:20260907T113000', 'RRULE:FREQ=WEEKLY;COUNT=3',
    'EXDATE:20260914T095000', 'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  const rows = parseCalendar(ICAL, input, true, midnight('2026-09-01'));
  assert.deepEqual(rows.map((row) => row.starts), [at('2026-09-07', '09:50'), at('2026-09-21', '09:50')]);
  assert.equal(rows[0].ends, at('2026-09-07', '11:30'));
  assert.equal(rows[0].source, 'jw');
});
