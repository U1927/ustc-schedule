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

export function shiftMonth(key, delta) {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 10);
}
