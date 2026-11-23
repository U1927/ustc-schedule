import express from 'express';
import { zipSync } from 'fflate';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { openDatabase, transaction } from './database.js';
import { pushKeys, pushSender, startReminders, subscriptionInput } from './push.js';
import { fetchCatalog } from './young.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const extension = new URL('../extension/', import.meta.url);
const derive = promisify(scrypt);
const SESSION_AGE = 30 * 86_400_000;
const dummySalt = randomBytes(16);
const SOURCES = ['manual', 'deadline', 'jw', 'young', 'ical'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });

function cleanText(value, length) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, length);
}

function eventInput(body, source, imported = false) {
  const title = cleanText(body.title, 160);
  const starts = body.starts;
  const ends = source === 'deadline' ? starts + 60_000 : body.ends;
  const { reminder = null } = body;
  if (!title || !Number.isSafeInteger(starts) || starts < 0 || !Number.isSafeInteger(ends)
    || ends <= starts || ends > 4_102_444_800_000
    || (reminder !== null && (!Number.isInteger(reminder) || reminder < 0 || reminder > 43_200))) {
    throw fail(400, '请检查标题、日期和提醒时间。');
  }
  let sourceUrl = '';
  if (body.sourceUrl) {
    try {
      const url = new URL(body.sourceUrl);
      const expected = source === 'young' ? 'young.ustc.edu.cn' : source === 'jw' ? 'jw.ustc.edu.cn' : '';
      if (expected && url.protocol === 'https:' && url.hostname === expected && !url.port
        && !url.username && !url.password && url.href.length <= 1200) sourceUrl = url.href;
    } catch { /* Optional link. */ }
  }
  const externalId = imported ? cleanText(body.externalId, 500) : null;
  if (imported && !externalId) throw fail(400, '导入记录缺少来源编号。');
  return { title, starts, ends, place: cleanText(body.place, 240), notes: cleanText(body.notes, 3000),
    source, sourceUrl, externalId, reminder, due: reminder === null ? null : starts - reminder * 60_000 };
}

export function createApp({ db, origin, disableSignup = false, contact, sender, youngCatalog = fetchCatalog }) {
  const app = express();
  const secure = new URL(origin).protocol === 'https:';
  const cookieName = secure ? '__Host-schedule' : 'schedule';
  const cookie = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  const keys = pushKeys(db);
  const send = sender ?? pushSender(keys, contact || origin);
  const reminders = startReminders(db, send);
  const loginLimits = new Map();
  const catalogCache = new Map();
  const eventList = db.prepare(`
    SELECT id,title,starts,ends,place,notes,source,sourceUrl,reminder,version FROM events
    WHERE account=? AND starts<? AND ends>? ORDER BY starts,id LIMIT 5001
  `);
  const eventById = db.prepare('SELECT * FROM events WHERE account=? AND id=?');
  const insertEvent = db.prepare(`
    INSERT INTO events(id,account,title,starts,ends,place,notes,source,sourceUrl,externalId,reminder,due)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account,source,externalId) DO NOTHING
  `);
  const updateEvent = db.prepare(`
    UPDATE events SET title=?,starts=?,ends=?,place=?,notes=?,source=?,sourceUrl=?,reminder=?,due=?,
      version=version+1,alarmVersion=alarmVersion+? WHERE account=? AND id=? AND version=?
  `);
  const selectAccount = db.prepare('SELECT id,handle,password FROM accounts WHERE handle=?');
  const selectSession = db.prepare(`
    SELECT a.id,a.handle FROM accounts a JOIN sessions s ON a.id=s.account WHERE s.token=? AND s.expires>?
  `);
  const selectDevice = db.prepare('SELECT id,account,subscription FROM devices WHERE endpoint=?');

  function addEvent(account, event) {
    const { title, starts, ends, place, notes, source, sourceUrl, externalId, reminder, due } = event;
    const id = randomUUID();
    const result = insertEvent.run(id, account, title, starts, ends, place, notes, source, sourceUrl, externalId, reminder, due);
    return result.changes ? id : null;
  }

  function sessionToken(req) {
    const value = req.headers.cookie?.split(';').map((item) => item.trim())
      .find((item) => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    return /^[\w-]{43}$/.test(value || '') ? hash(value) : null;
  }

  function loginAllowed(req) {
    const now = Date.now();
    if (loginLimits.size >= 1000) {
      for (const [address, entry] of loginLimits) if (entry.until <= now) loginLimits.delete(address);
      if (loginLimits.size >= 1000 && !loginLimits.has(req.ip)) throw fail(429, '请求过于频繁，请稍后重试。');
    }
    const current = loginLimits.get(req.ip);
    const entry = current?.until > now ? current : { until: now + 900_000, count: 0 };
    if (entry.count >= 20) throw fail(429, '请求过于频繁，请 15 分钟后重试。');
    entry.count++;
    loginLimits.set(req.ip, entry);
  }

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff'
    });
    next();
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') !== origin) return next(fail(403, '请求来源不匹配。'));
    req.account = selectSession.get(sessionToken(req), Date.now());
    next();
  });
  app.use('/api', express.json({ limit: '5mb' }));

  app.get('/api/session', (req, res) => res.json({ handle: req.account?.handle ?? null, signup: !disableSignup, pushKey: keys.publicKey }));
  app.post('/api/session', async (req, res) => {
    loginAllowed(req);
    const { handle = '', password = '', register = false } = req.body ?? {};
    if (typeof handle !== 'string' || !/^[a-z\d_-]{3,32}$/i.test(handle) || typeof password !== 'string'
      || password.length < 10 || password.length > 128) throw fail(400, '账号需为 3–32 位字母、数字、下划线或连字符。密码需为 10–128 个字符。');
    const normalized = handle.toLowerCase();
    let account = selectAccount.get(normalized);
    if (register === true) {
      if (disableSignup) throw fail(403, '此实例已关闭注册。');
      if (account) throw fail(409, '此账号已存在。');
      const salt = randomBytes(16);
      const secret = await derive(password, salt, 64);
      const result = db.prepare('INSERT INTO accounts(handle,password) VALUES (?,?) ON CONFLICT(handle) DO NOTHING')
        .run(normalized, `${salt.toString('hex')}:${secret.toString('hex')}`);
      if (!result.changes) throw fail(409, '此账号已存在。');
      account = { id: Number(result.lastInsertRowid), handle: normalized };
    } else {
      const [salt, expected] = account?.password.split(':') ?? [];
      const secret = await derive(password, salt ? Buffer.from(salt, 'hex') : dummySalt, 64);
      if (!account || !timingSafeEqual(secret, Buffer.from(expected, 'hex'))) throw fail(401, '账号或密码错误。');
    }
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    transaction(db, () => {
      db.prepare('DELETE FROM sessions WHERE expires<=? OR token=?').run(now, sessionToken(req));
      db.prepare('INSERT INTO sessions(token,account,expires) VALUES (?,?,?)').run(hash(token), account.id, now + SESSION_AGE);
    });
    res.cookie(cookieName, token, { ...cookie, maxAge: SESSION_AGE }).json({ handle: account.handle });
  });
  app.delete('/api/session', (req, res) => {
    transaction(db, () => {
      if (req.account) db.prepare('DELETE FROM devices WHERE account=? AND endpoint=?')
        .run(req.account.id, cleanText(req.body?.endpoint, 2048));
      db.prepare('DELETE FROM sessions WHERE token=?').run(sessionToken(req));
    });
    res.clearCookie(cookieName, cookie).status(204).end();
  });
  app.use('/api', (req, res, next) => req.account ? next() : next(fail(401, '请先登录。')));

  app.get('/api/events', (req, res) => {
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from >= to || to - from > 93 * 86_400_000) {
      throw fail(400, '请选择有效的日历日期范围。');
    }
    const rows = eventList.all(req.account.id, to, from);
    if (rows.length > 5000) throw fail(400, '该时间段日程过多，请缩小查看范围。');
    res.json(rows);
  });
  app.post('/api/events', (req, res) => {
    const body = req.body ?? {};
    const source = body.source === 'deadline' ? 'deadline' : 'manual';
    const id = addEvent(req.account.id, eventInput(body, source));
    res.status(201).json({ id });
  });
  app.post('/api/import', (req, res) => {
    const { events } = req.body ?? {};
    if (!Array.isArray(events) || events.length < 1 || events.length > 2500) throw fail(400, '请选择 1–2500 条记录。');
    const rows = events.map((row) => {
      if (!row || !['jw', 'young', 'ical'].includes(row.source)) throw fail(400, '导入来源无效。');
      return eventInput(row, row.source, true);
    });
    const added = transaction(db, () => rows.reduce((count, row) => count + Number(Boolean(addEvent(req.account.id, row))), 0));
    res.json({ added, skipped: rows.length - added });
  });
  app.put('/api/events/:id', (req, res) => {
    const old = eventById.get(req.account.id, req.params.id);
    if (!old) throw fail(404, '此日程已不存在。');
    const body = req.body ?? {};
    const source = ['deadline', 'manual'].includes(old.source) && ['deadline', 'manual'].includes(body.source) ? body.source : old.source;
    const row = eventInput({ ...body, sourceUrl: old.sourceUrl }, source);
    const { title, starts, ends, place, notes, sourceUrl, reminder, due } = row;
    const reschedule = Number(old.due !== due || old.starts !== starts);
    const result = updateEvent.run(title, starts, ends, place, notes, source, sourceUrl, reminder, due,
      reschedule, req.account.id, old.id, body.version ?? null);
    if (!result.changes) throw fail(409, '此日程已在其他设备更新，请重新打开。');
    res.json({ id: old.id, version: old.version + 1 });
  });
  app.delete('/api/events/:id', (req, res) => {
    const changes = db.prepare('DELETE FROM events WHERE account=? AND id=? AND version=?')
      .run(req.account.id, req.params.id, Number(req.query.version)).changes;
    if (!changes) throw fail(409, '此日程已变更，请刷新后重试。');
    res.status(204).end();
  });
  app.get('/api/events/:id', (req, res) => {
    const event = eventById.get(req.account.id, req.params.id);
    if (!event || !SOURCES.includes(event.source)) throw fail(404, '找不到此日程。');
    const { account, externalId, due, alarmVersion, ...record } = event;
    res.json(record);
  });
  app.get('/api/campus/young', async (req, res) => {
    const page = Number(req.query.page ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 100) throw fail(400, '活动页码无效。');
    const now = Date.now();
    const cached = catalogCache.get(page);
    const record = cached?.expires > now ? cached
      : { expires: now + 120_000, result: youngCatalog(page) };
    catalogCache.set(page, record);
    try {
      res.json(await record.result);
    } catch {
      if (catalogCache.get(page) === record) catalogCache.delete(page);
      throw fail(502, '活动目录暂时不可用。你仍可从青春科大详情页导入。');
    }
  });
  app.post('/api/devices', (req, res) => {
    const subscription = subscriptionInput(req.body);
    if (!subscription) throw fail(400, '此浏览器的推送服务暂不受支持。');
    transaction(db, () => {
      const old = selectDevice.get(subscription.endpoint);
      if (old && old.account !== req.account.id) db.prepare('DELETE FROM devices WHERE id=?').run(old.id);
      db.prepare(`INSERT INTO devices(account,endpoint,subscription) VALUES (?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription`)
        .run(req.account.id, subscription.endpoint, JSON.stringify(subscription));
    });
    res.status(204).end();
  });
  app.delete('/api/devices', (req, res) => {
    db.prepare('DELETE FROM devices WHERE account=? AND endpoint=?').run(req.account.id, cleanText(req.body?.endpoint, 2048));
    res.status(204).end();
  });
  app.post('/api/devices/test', async (req, res) => {
    const device = selectDevice.get(cleanText(req.body?.endpoint, 2048));
    if (device?.account !== req.account.id) throw fail(404, '请先开启此设备的提醒。');
    try {
      await send(JSON.parse(device.subscription), { title: '科大日程', body: '这台设备已可以接收提醒。', url: '/' });
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) db.prepare('DELETE FROM devices WHERE id=?').run(device.id);
      throw fail(502, '推送服务发送失败，请重新开启提醒后重试。');
    }
    res.status(204).end();
  });

  app.use('/api', (req, res) => res.status(404).json({ error: '此接口不存在。' }));
  app.get('/vendor/ical.js', (req, res) => res.sendFile(fileURLToPath(import.meta.resolve('ical.js'))));
  app.get('/ustc-import-extension.zip', (req, res) => {
    const files = Object.fromEntries(['manifest.json', 'popup.html', 'popup.js', 'popup.css'].map((name) =>
      [name, readFileSync(new URL(name, extension))]));
    for (const name of ['school.js', 'dates.js']) files[name] = readFileSync(resolve(root, name));
    res.attachment('ustc-import-extension.zip').send(Buffer.from(zipSync(files)));
  });
  app.use(express.static(root, { setHeaders(res, path) {
    if (path.endsWith('sw.js')) res.set('Cache-Control', 'no-cache');
  } }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status >= 400 && error.status <= 499 ? error.status : 500;
    if (status === 500 && !error.status) console.error(error);
    res.status(error.status === 502 ? 502 : status).json({
      error: error.type === 'entity.too.large' ? '导入内容超过大小限制。'
        : error.type === 'entity.parse.failed' ? '请求格式有误。'
        : error.status ? error.message : '服务暂时无法完成请求。'
    });
  });
  return { app, reminders };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const origin = new URL(process.env.APP_ORIGIN || `http://localhost:${port}`).origin;
  const db = openDatabase(process.env.DATABASE_PATH || 'data/schedule.sqlite');
  const { app } = createApp({
    db, origin, disableSignup: process.env.DISABLE_SIGNUP === '1', contact: process.env.PUSH_CONTACT || undefined
  });
  app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`科大日程 · ${origin}`));
}
