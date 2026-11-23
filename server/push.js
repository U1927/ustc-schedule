import webPush from 'web-push';
import { transaction } from './database.js';

const MINUTE = 60_000;
const GRACE = 5 * MINUTE;

export function pushKeys(db) {
  return transaction(db, () => {
    const saved = db.prepare("SELECT value FROM settings WHERE key='vapid'").get();
    if (saved) return JSON.parse(saved.value);
    const keys = webPush.generateVAPIDKeys();
    db.prepare("INSERT INTO settings (key, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
    return keys;
  });
}

export function subscriptionInput(value) {
  try {
    const endpoint = new URL(value.endpoint);
    const host = endpoint.hostname;
    const trusted = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com'].includes(host)
      || /(?:^|\.)push\.apple\.com$/.test(host)
      || /(?:^|\.)notify\.windows\.com$/.test(host);
    const { p256dh, auth } = value.keys;
    if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password || endpoint.hash
      || !trusted || endpoint.href.length > 2048 || !/^[\w-]{87}$/.test(p256dh) || !/^[\w-]{22}$/.test(auth)) return null;
    return { endpoint: endpoint.href, keys: { p256dh, auth } };
  } catch {
    return null;
  }
}

export function pushSender(keys, subject) {
  return (subscription, payload) => webPush.sendNotification(subscription, JSON.stringify(payload), {
    TTL: 300, timeout: 7_000, vapidDetails: { subject, ...keys }
  });
}

export function startReminders(db, send) {
  const candidates = db.prepare(`
    SELECT e.id, e.title, e.place, e.starts, e.reminder, e.alarmVersion, e.source,
           d.id AS device, d.subscription, COALESCE(q.attempts, 0) AS attempts
    FROM events e JOIN devices d ON d.account=e.account
    LEFT JOIN deliveries q ON q.event=e.id AND q.device=d.id AND q.alarmVersion=e.alarmVersion
    WHERE e.due BETWEEN ? AND ? AND (q.next IS NULL OR (q.done=0 AND q.next<=?))
    ORDER BY e.due LIMIT 20
  `);
  const claim = db.prepare(`
    INSERT INTO deliveries(event, device, alarmVersion, next, attempts) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(event, device, alarmVersion) DO UPDATE SET next=excluded.next, attempts=attempts+1
    WHERE done=0 AND deliveries.next<=?
  `);
  const finish = db.prepare('UPDATE deliveries SET done=?, next=? WHERE event=? AND device=? AND alarmVersion=?');
  const dead = db.prepare('DELETE FROM devices WHERE id=?');
  let running = false;
  async function tick(now = Date.now()) {
    if (running) return;
    running = true;
    try {
      const claimed = transaction(db, () => candidates.all(now - GRACE, now, now).filter((job) =>
        claim.run(job.id, job.device, job.alarmVersion, now + MINUTE, now).changes));
      await Promise.all(claimed.map(async (job) => {
        const args = [job.id, job.device, job.alarmVersion];
        try {
          await send(JSON.parse(job.subscription), {
            title: job.title,
            body: [job.source === 'deadline'
              ? job.reminder ? `截止提醒 · 还剩 ${job.reminder} 分钟` : '截止时间已到'
              : job.reminder ? `提前 ${job.reminder} 分钟提醒` : '日程开始', job.place].filter(Boolean).join(' · '),
            tag: job.id, url: `/?event=${job.id}`
          });
          finish.run(1, 0, ...args);
        } catch (error) {
          if ([404, 410].includes(error.statusCode)) dead.run(job.device);
          else finish.run(job.attempts >= 3 || (error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) ? 1 : 0,
            now + 20_000 * 2 ** job.attempts, ...args);
        }
      }));
    } finally {
      running = false;
    }
  }
  const timer = setInterval(() => tick().catch((error) => console.error('Reminder worker:', error.message)), 10_000);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}
