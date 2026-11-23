import { DAY, dayKey, midnight } from './dates.js';

function epoch(ICAL, value) {
  if (!value) return NaN;
  if (value.zone === ICAL.Timezone.localTimezone || value.isDate) {
    const text = value.toString();
    return value.isDate ? midnight(text) : Date.parse(`${text}+08:00`);
  }
  return value.toJSDate().getTime();
}

export function parseCalendar(ICAL, text, asCourses, now = Date.now()) {
  const calendar = new ICAL.Component(ICAL.parse(text.replace(/^\uFEFF/, '')));
  for (const component of calendar.getAllSubcomponents('vtimezone')) {
    const zone = new ICAL.Timezone(component);
    ICAL.TimezoneService.register(zone);
  }
  const byUid = new Map();
  for (const component of calendar.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(component);
    if (!byUid.has(event.uid)) byUid.set(event.uid, []);
    byUid.get(event.uid).push(event);
  }
  const events = [];
  const append = (item, start, end, uid, occurrence) => {
    const title = item.summary || '未命名日程';
    const starts = epoch(ICAL, start);
    let ends = epoch(ICAL, end);
    if (!Number.isFinite(starts) || starts < 0 || starts > 4_102_444_740_000) return;
    if (!Number.isFinite(ends) || ends <= starts) ends = starts + (start.isDate ? DAY : 3_600_000);
    events.push({ title, starts, ends, place: item.location || '', notes: item.description || '',
      source: asCourses ? 'jw' : 'ical', externalId: `ics:${String(uid || title).slice(0, 450)}:${occurrence}`, reminder: null });
    if (events.length > 2500) throw new Error('日历文件超过 2500 条日程，请分学期导入。');
  };
  for (const [uid, group] of byUid) {
    const main = group.find((item) => !item.isRecurrenceException());
    if (!main || main.component.getFirstPropertyValue('status') === 'CANCELLED' || !main.startDate) continue;
    if (!main.isRecurring()) {
      append(main, main.startDate, main.endDate, uid, epoch(ICAL, main.startDate));
      continue;
    }
    group.filter((item) => item.isRecurrenceException()).forEach((item) => main.relateException(item));
    const from = midnight(dayKey(now)) - 366 * DAY;
    const until = Math.max(epoch(ICAL, main.startDate), midnight(dayKey(now))) + 366 * DAY;
    const iterator = main.iterator();
    for (let count = 0; count < 25_000; count++) {
      const next = iterator.next();
      if (!next || epoch(ICAL, next) >= until) break;
      if (count === 24_999) throw new Error('此日历的重复规则过于密集，请导出较短的日期范围。');
      if (epoch(ICAL, next) < from) continue;
      const occurrence = main.getOccurrenceDetails(next);
      if (occurrence.item.component.getFirstPropertyValue('status') !== 'CANCELLED') {
        append(occurrence.item, occurrence.startDate, occurrence.endDate, uid, epoch(ICAL, next));
      }
    }
  }
  if (!events.length) throw new Error('此文件中没有可导入的日程。');
  return events.sort((a, b) => a.starts - b.starts);
}
