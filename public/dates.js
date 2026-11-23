export const DAY = 86_400_000;
export const SHANGHAI = 'Asia/Shanghai';
const hourOffset = 8 * 3_600_000;
const localDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHANGHAI, year: 'numeric', month: '2-digit', day: '2-digit'
});
const clock = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: SHANGHAI, weekday: 'long' });

export const dayKey = (epoch = Date.now()) => localDate.format(epoch);
export const midnight = (key) => Date.parse(`${key}T00:00:00+08:00`);
export const at = (key, time) => Date.parse(`${key}T${time}:00+08:00`);
export const clockText = (epoch) => clock.format(epoch);
export const weekdayText = (epoch) => weekday.format(epoch);
export const localInput = (epoch) => new Date(epoch + hourOffset).toISOString().slice(0, 16);
export const parseInput = (value) => /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value) ? Date.parse(`${value}:00+08:00`) : NaN;
export const dateTimeText = (epoch) => `${dayKey(epoch)} ${clockText(epoch)}`;

export function monthGrid(key) {
  const [year, month] = key.split('-').map(Number);
  const first = Date.UTC(year, month - 1, 1);
  const weekdayIndex = (new Date(first).getUTCDay() + 6) % 7;
  const from = first - weekdayIndex * DAY - hourOffset;
  return Array.from({ length: 42 }, (_, index) => from + index * DAY);
}

export function calendarDays(view, key) {
  if (view === 'month') return monthGrid(key);
  const date = midnight(key);
  if (view === 'day') return [date];
  const weekdayIndex = (new Date(date + hourOffset).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => date + (index - weekdayIndex) * DAY);
}

export function shiftCalendar(view, key, delta) {
  if (view !== 'month') return dayKey(midnight(key) + delta * (view === 'week' ? 7 : 1) * DAY);
  const [year, month, day] = key.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month + delta, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + delta, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function calendarTitle(view, key, days) {
  const [year, month, day] = key.split('-').map(Number);
  if (view === 'month') return `${year} 年 ${month} 月`;
  if (view === 'day') return `${year} 年 ${month} 月 ${day} 日`;
  const [firstYear, firstMonth, firstDay] = dayKey(days[0]).split('-').map(Number);
  const [lastYear, lastMonth, lastDay] = dayKey(days.at(-1)).split('-').map(Number);
  const start = `${firstYear} 年 ${firstMonth} 月 ${firstDay}`;
  if (firstYear === lastYear && firstMonth === lastMonth) return `${start}–${lastDay} 日`;
  const end = firstYear === lastYear ? `${lastMonth} 月 ${lastDay} 日` : `${lastYear} 年 ${lastMonth} 月 ${lastDay} 日`;
  return `${start} 日 – ${end}`;
}
