import { test } from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { at, dayKey, midnight, monthGrid } from '../public/dates.js';
import { parseCalendar } from '../public/ical-import.js';
import { courseLessons, parseActivity, parseCourses } from '../public/school.js';
import { projectCatalog } from '../server/young.js';
import { readCourses } from '../extension/jw-page.js';

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

test('JW extension joins selected lesson IDs to the dated timetable response', async () => {
  const root = 'https://jw.ustc.edu.cn';
  const selection = '/for-std/course-table/get-data?bizTypeId=2&semesterId=123&dataId=456';
  const snapshot = { studentTableVm: { lessonIds: [22, 22] }, lessonId2Lesson: { 22: { id: 22, courseName: '测试课' } } };
  const datum = { result: {
    lessonList: [{ id: 22, courseName: '测试课' }, { id: 11, courseName: '未选课' }],
    scheduleList: [
      { lessonId: 22, date: '2026-08-31', startTime: 750, endTime: 925, room: { nameZh: '测试教室' } },
      { lessonId: 22, date: '2026-09-04', startTime: 1400, endTime: 1535, customPlace: '测试实验室' },
      { lessonId: 11, date: '2026-08-31', startTime: 750, endTime: 925 }
    ]
  } };
  const requests = [];
  const result = await readCourses({
    location: { href: root + '/for-std/course-table/info/456' },
    performance: { getEntriesByType: () => [{ name: root + selection }] },
    document: { querySelector: () => null },
    fetch: async (url, args) => {
      requests.push({ url, args });
      return Response.json(requests.length === 1 ? snapshot : datum);
    }
  });
  assert.equal(requests[0].url.href, root + selection);
  assert.equal(requests[1].url.href, root + '/ws/schedule-table/datum');
  assert.equal(requests[1].args.method, 'POST');
  assert.equal(requests[1].args.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(requests[1].args.body), { lessonIds: ['22'] });
  const lessons = courseLessons(result.snapshot, result.datum);
  assert.equal(lessons.length, 1);
  const { events, missing } = parseCourses({ kind: 'ustc-courses', lessons });
  assert.equal(missing, 0);
  assert.deepEqual(events.map(({ starts, ends, place }) => [starts, ends, place]), [
    [at('2026-08-31', '07:50'), at('2026-08-31', '09:25'), '测试教室'],
    [at('2026-09-04', '14:00'), at('2026-09-04', '15:35'), '测试实验室']
  ]);
  assert.match(parseCourses(datum).events[0].place, /测试教室/);
  const oldFile = { kind: 'ustc-courses', lessons: courseLessons(snapshot) };
  assert.throws(() => parseCourses(oldFile, '2026-08-31'), /1 门课，但没有上课时间/);
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
