import { DAY, at, dayKey, midnight } from './dates.js';

export const JW = 'https://jw.ustc.edu.cn/for-std/course-table';
export const YOUNG = 'https://young.ustc.edu.cn/';
const periods = [
  ['07:50', '08:35'], ['08:40', '09:25'], ['09:45', '10:30'], ['10:35', '11:20'],
  ['11:25', '12:10'], ['14:00', '14:45'], ['14:50', '15:35'], ['15:55', '16:40'],
  ['16:45', '17:30'], ['17:35', '18:20'], ['19:30', '20:15'], ['20:20', '21:05'], ['21:10', '21:55']
];
const days = '一二三四五六日';
const firstArray = (...arrays) => arrays.find((array) => Array.isArray(array) && array.length) ?? [];
const string = (value) => typeof value === 'string' ? value.trim() : '';
const localText = (value) => string(value) || string(value?.cn) || string(value?.nameZh) || string(value?.zh) || string(value?.en);

function scheduleSlot(activity) {
  return {
    date: activity.date ?? activity.scheduleDate,
    starts: activity.startTime ?? activity.beginTime,
    ends: activity.endTime,
    day: activity.weekday ?? activity.weekDay ?? activity.dayOfWeek,
    startUnit: activity.startUnit ?? activity.startSection,
    endUnit: activity.endUnit ?? activity.endSection,
    weekIndexes: activity.weekIndexes ?? activity.weeks ?? activity.weekIndex,
    place: localText(activity.roomName) || localText(activity.room) || localText(activity.place)
  };
}

export function courseLessons(payload) {
  const table = payload?.studentTableVm ?? payload ?? {};
  const ids = firstArray(table.lessonIds, payload?.lessonIds).map(String);
  const details = [...firstArray(table.lessons, payload?.lessons), ...Object.values(payload?.lessonId2Lesson ?? {})];
  const byId = new Map(details.map((lesson) => [String(lesson?.id), lesson]));
  const data = ids.length ? [...new Set(ids)].map((id) => byId.get(id)) : details;
  const grouped = new Map();
  for (const row of firstArray(table.activities, table.schedules, payload?.activities, payload?.schedules)) {
    const id = String(row?.lessonId ?? row?.lesson?.id ?? '');
    if (!id) continue;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }
  return data.filter(Boolean).map((lesson) => ({
    key: String(lesson.id ?? lesson.code ?? lesson.lessonCode ?? ''),
    title: localText(lesson.courseName) || localText(lesson.course) || string(lesson.name),
    schedule: localText(lesson.dateTimePlacePersonText),
    activities: firstArray(grouped.get(String(lesson.id)), lesson.scheduleList, lesson.vms, lesson.arrangements, lesson.activities)
      .filter((activity) => activity && typeof activity === 'object').map(scheduleSlot)
  }));
}

function weekNumbers(text) {
  if (Array.isArray(text)) return [...new Set(text.flatMap(weekNumbers))];
  const weeks = new Set();
  for (const match of String(text ?? '').replace(/[－—–~～至]/g, '-').matchAll(/(\d{1,2})(?:\s*-\s*(\d{1,2}))?/g)) {
    const first = Number(match[1]);
    const last = Number(match[2] || first);
    for (let week = Math.max(1, first); week <= Math.min(30, last); week++) {
      const oddOnly = /单/.test(text) && !/双/.test(text);
      const evenOnly = /双/.test(text) && !/单/.test(text);
      if ((!oddOnly || week % 2) && (!evenOnly || week % 2 === 0)) weeks.add(week);
    }
  }
  return [...weeks];
}

function validDate(key) {
  const epoch = midnight(key);
  return Number.isFinite(epoch) && dayKey(epoch) === key ? key : null;
}

function dayNumber(value) {
  if (value == null || value === '') return NaN;
  if (value === '天') return 7;
  const index = days.indexOf(String(value));
  return index >= 0 ? index + 1 : Number(value);
}

function clockValue(value) {
  const text = String(value ?? '').trim();
  const parts = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/) || text.match(/^(\d{1,2})(\d{2})$/);
  if (!parts || Number(parts[1]) > 23 || Number(parts[2]) > 59) return null;
  return `${parts[1].padStart(2, '0')}:${parts[2]}`;
}

function parseCourseText(value) {
  const body = value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ')
    .replace(/[－—–~～]/g, '-').replaceAll('：', ':')
    .replace(/(?<!\d)([1-7])\s*[（(]\s*(\d{1,2}(?:\s*[,，、-]\s*\d{1,2})*)\s*[）)]/g, '周$1($2)');
  const rows = [];
  const weekday = /(?:星期|周)([一二三四五六日天1-7])/g;
  const matches = [...body.matchAll(weekday)];
  for (const [index, match] of matches.entries()) {
    const tail = body.slice(match.index + match[0].length, matches[index + 1]?.index ?? body.length);
    const prefix = body.slice(index ? matches[index - 1].index + matches[index - 1][0].length : 0, match.index);
    const weekPattern = /(?:第\s*)?([\d,，、\s-]+)(?:\s*[(（]?([单双])周?[）)]?)?\s*周(?:\s*[(（]([单双])周?[)）])?/;
    const tailLine = tail.split(/[;；\n]/, 1)[0];
    const previousLine = prefix.split(/[;；\n]/).at(-1);
    const exclusion = /(?:除|不含)\s*第?([\d,，、\s-]+)周/;
    const week = tailLine.replace(exclusion, '').match(weekPattern) || previousLine.match(weekPattern);
    const unit = tail.match(/(?:第\s*)?(\d{1,2})(?:\s*[-、,，至]\s*(\d{1,2}))?\s*节/)
      || tail.match(/^\s*[(（\[]\s*(\d{1,2})(?:\s*[-至,，、]\s*(\d{1,2}))*\s*[)）\]]/);
    const clock = tail.match(/(\d{1,2}:\d{2})\s*(?:-|至)\s*(\d{1,2}:\d{2})/);
    if (!week || (!unit && !clock)) continue;
    const rawPlace = tail.match(/(?:地点|教室)\s*[:：]\s*([^\n;；]+)/)?.[1];
    const place = rawPlace || tail.slice(Math.max(
      tail.indexOf(week[0]) >= 0 ? tail.indexOf(week[0]) + week[0].length : 0,
      unit ? unit.index + unit[0].length : 0, clock ? clock.index + clock[0].length : 0
    )).split(/[;；\n]/, 1)[0].replace(/^[\s:：,，()（）\[\]]+/, '').trim();
    const excluded = weekNumbers(tailLine.match(exclusion)?.[1]);
    const included = weekNumbers(week[1] + (week[2] || week[3] || '')).filter((index) => !excluded.includes(index));
    rows.push({ day: match[1], weekIndexes: included, startUnit: unit?.[1],
      endUnit: unit?.[2] || unit?.[1], starts: clock?.[1], ends: clock?.[2], place });
  }
  return rows;
}

export function parseCourses(file, chosenDate) {
  const lessons = Array.isArray(file?.lessons) && file.kind === 'ustc-courses' ? file.lessons : courseLessons(file);
  const semester = validDate(chosenDate || file?.monday || '');
  const base = semester ? midnight(semester) : NaN;
  if (semester && new Date(base + 8 * 3_600_000).getUTCDay() !== 1) throw new Error('请选择第一教学周的周一。');
  const events = new Map();
  let missing = 0;
  for (const lesson of lessons) {
    if (!lesson?.title) { missing++; continue; }
    const structured = firstArray(lesson.activities);
    const expand = (schedules) => schedules.flatMap((slot) => {
      if (!slot || typeof slot !== 'object') return [];
      const startClock = clockValue(slot.starts) || periods[Number(slot.startUnit) - 1]?.[0];
      const endClock = clockValue(slot.ends) || periods[Number(slot.endUnit ?? slot.startUnit) - 1]?.[1];
      if (!startClock || !endClock || startClock >= endClock) return [];
      const date = validDate(string(slot.date).slice(0, 10));
      const day = dayNumber(slot.day);
      const weeks = weekNumbers(slot.weekIndexes);
      if (!date && (!semester || !Number.isInteger(day) || day < 1 || day > 7)) return [];
      const dates = date ? [date] : weeks.map((week) => dayKey(base + ((week - 1) * 7 + day - 1) * DAY));
      return dates.map((key) => {
        const ends = at(key, endClock);
        const starts = at(key, startClock);
        const externalId = `${lesson.key || lesson.title}:${starts}`;
        return { title: lesson.title, starts, ends, place: string(slot.place), source: 'jw',
          sourceUrl: JW, externalId, reminder: null };
      });
    });
    const dated = expand(structured);
    const rows = dated.length ? dated : expand(parseCourseText(string(lesson.schedule)));
    for (const row of rows) events.set(row.externalId, row);
    if (!rows.length) missing++;
  }
  if (!events.size) throw new Error(!semester
    ? '没有识别到课程日期。请填写第一教学周的周一后重试，或上传 .ics 文件。'
    : '没有识别到可导入的课程。请确认选中了正确的学期，或上传 .ics 文件。');
  return { events: [...events.values()].sort((a, b) => a.starts - b.starts), missing };
}

const dateToken = /(?:(\d{4})\s*[-/.年]\s*)?(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?\s*(?:[（(][^）)]+[）)])?\s*(\d{1,2})\s*[:：]\s*(\d{2})(?::\d{2})?/g;

function activityTime(text, fallback) {
  const match = [...text.matchAll(dateToken)][0];
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const key = `${year || fallback}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const time = clockValue(`${hour}:${minute}`);
  if (!validDate(key) || !time || Number(key.slice(0, 4)) < 2000) return null;
  return { epoch: at(key, time), endIndex: match.index + match[0].length };
}

export function youngSource(value) {
  try {
    const url = new URL(value);
    if (url.origin !== new URL(YOUNG).origin || url.username || url.password
      || /^\/(?:nginx_auth|login|logout)(?:\/|\.php|$)/i.test(url.pathname)) return '';
    for (const name of [...url.searchParams.keys()]) {
      if (/token|ticket|session|password|auth|code/i.test(name)) url.searchParams.delete(name);
    }
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

export function parseActivity(file, sourceUrl, year = dayKey().slice(0, 4)) {
  if (file?.kind === 'ustc-activity') {
    const title = string(file.title).slice(0, 160);
    const { starts, ends } = file;
    const url = youngSource(sourceUrl || file.url);
    if (!title || !Number.isSafeInteger(starts) || !Number.isSafeInteger(ends) || starts < 0 || ends <= starts
      || ends > 4_102_444_800_000) throw new Error('活动文件中的标题或时间无效。');
    return { title, starts, ends, place: string(file.place), notes: string(file.notes),
      source: 'young', sourceUrl: url, externalId: `${url || title}:${starts}`, reminder: null };
  }
  const lines = string(file?.text ?? file).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const title = string(file?.title) || lines.find((line) => !/^(青春科大|第二课堂|活动详情|首页)$/.test(line));
  const text = lines.join('\n');
  const labelled = /^(?:活动|举办|开始|进行|讲座)(?:开始)?(?:日期|时间|时段)?[：:\s]+([^\n]+)(?:\n\s*((?:\d{4}|\d{1,2}[-/.月]\d{1,2})[^\n]*))?/m.exec(text);
  const timing = labelled ? [labelled[1], labelled[2]].filter(Boolean).join(' ') : lines.filter((line) =>
    !/报名|注册|发布|截止报名/.test(line)).slice(0, 12).join('\n');
  const first = activityTime(timing, year);
  if (!title || !first) throw new Error('没有识别到活动开始时间。请复制包含标题和「活动时间」的详情正文，或手动新建日程。');
  const rest = timing.slice(first.endIndex);
  const explicitEnd = /^\s*[-－—~～至到]\s*(\d{1,2}[:：]\d{2})/.exec(rest)?.[1];
  const endLabel = /^(?:活动结束|结束)(?:日期|时间)?[：:\s]+([^\n]+)/m.exec(text)?.[1];
  const endYear = dayKey(first.epoch).slice(0, 4);
  const nextDate = endLabel ? activityTime(endLabel, endYear)?.epoch
    : /^\s*[-－—~～至到]/.test(rest) ? activityTime(rest, endYear)?.epoch : null;
  const endClock = explicitEnd && clockValue(explicitEnd.replace('：', ':'));
  let ends = nextDate ?? (endClock ? at(dayKey(first.epoch), endClock) : NaN);
  const knownEnd = Number.isFinite(ends) && ends > first.epoch;
  if (!knownEnd) ends = first.epoch + 3_600_000;
  const place = /^(?:活动地点|举办地点|活动场地|地点|场地)\s*[：:]?\s*([^\n]+|\n[^\n]+)/m.exec(text)?.[1]?.trim() || '';
  const url = youngSource(sourceUrl || file?.url);
  const cleanTitle = title.replace(/^(?:活动标题|活动名称|标题)\s*[:：]\s*/, '').slice(0, 160);
  const externalId = `${url || cleanTitle}:${first.epoch}`;
  return { title: cleanTitle, starts: first.epoch, ends, place, source: 'young', sourceUrl: url,
    notes: knownEnd ? '' : '来源未提供结束时间，暂按 1 小时安排。', externalId, reminder: null };
}
