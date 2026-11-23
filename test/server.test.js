import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { unzipSync } from 'fflate';
import { openDatabase } from '../server/database.js';
import { createApp } from '../server/index.js';

test('login, device sync, DDL reminder, campus import and app assets', async (t) => {
  const db = openDatabase(':memory:');
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const pushes = [];
  const stamp = Date.now();
  const catalog = { page: 1, more: false, synced: stamp, items: [] };
  const { app, reminders } = createApp({ db, origin,
    sender: async (subscription, payload) => pushes.push({ subscription, payload }),
    youngCatalog: async () => catalog });
  server.on('request', app);
  t.after(async () => {
    reminders.stop();
    await new Promise((done) => server.close(done));
    db.close();
  });
  const request = (route, { method = 'GET', body, cookie, validOrigin = true } = {}) => fetch(origin + route, {
    method, headers: { ...(validOrigin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined
  });
  const credentials = { handle: 'student_name', password: 'unit test passphrase' };
  const register = await request('/api/session', { method: 'POST', body: { ...credentials, register: true } });
  assert.equal(register.status, 200);
  const phone = register.headers.get('set-cookie').split(';')[0];
  const login = await request('/api/session', { method: 'POST', body: credentials });
  assert.equal(login.status, 200);
  const desktop = login.headers.get('set-cookie').split(';')[0];
  const guest = await request('/api/session', { method: 'POST', body: { ...credentials, handle: 'different_user', register: true } });
  const guestCookie = guest.headers.get('set-cookie').split(';')[0];
  const due = stamp + 20 * 60_000;
  const body = { title: '交作业', starts: due, source: 'deadline', reminder: 15 };
  assert.equal((await request('/api/events', { method: 'POST', body, cookie: phone, validOrigin: false })).status, 403);
  const create = await request('/api/events', { method: 'POST', body, cookie: phone });
  assert.equal(create.status, 201);
  const { id } = await create.json();
  const eventsUrl = `/api/events?from=${stamp}&to=${stamp + 86_400_000}`;
  const [saved] = await (await request(eventsUrl, { cookie: desktop })).json();
  assert.equal(saved.id, id);
  assert.equal(saved.ends, due + 60_000);
  assert.equal(saved.source, 'deadline');
  assert.deepEqual(await (await request(eventsUrl, { cookie: guestCookie })).json(), []);
  assert.equal((await request(`/api/events/${id}`, { cookie: guestCookie })).status, 404);
  const changed = { ...body, title: '提交作业', version: saved.version };
  assert.equal((await request(`/api/events/${id}`, { method: 'PUT', body: changed, cookie: phone })).status, 200);
  assert.equal((await request(`/api/events/${id}`, { method: 'PUT', body: changed, cookie: desktop })).status, 409);

  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint', keys: {
    p256dh: 'a'.repeat(87), auth: 'a'.repeat(22)
  } };
  const counterfeit = { ...subscription, endpoint: 'https://fcm.googleapis.com.evil.example/fcm/send/test-endpoint' };
  assert.equal((await request('/api/devices', { method: 'POST', body: counterfeit, cookie: phone })).status, 400);
  assert.equal((await request('/api/devices', { method: 'POST', body: subscription, cookie: phone })).status, 204);
  await reminders.tick(stamp + 4 * 60_000);
  assert.equal(pushes.length, 0);
  await reminders.tick(stamp + 5 * 60_000);
  await reminders.tick(stamp + 5 * 60_000 + 1000);
  assert.equal(pushes.length, 1);
  assert.match(pushes[0].payload.body, /截止提醒/);
  assert.equal(pushes[0].payload.title, '提交作业');
  assert.equal((await request('/api/devices/test', { method: 'POST', body: { endpoint: subscription.endpoint }, cookie: guestCookie })).status, 404);

  assert.deepEqual(await (await request('/api/campus/young', { cookie: desktop })).json(), catalog);
  const course = { ...body, title: '课程', ends: due + 3600_000, source: 'jw', externalId: 'course-1' };
  const doImport = () => request('/api/import', { method: 'POST', body: { events: [course] }, cookie: desktop });
  assert.deepEqual(await (await doImport()).json(), { added: 1, skipped: 0 });
  assert.deepEqual(await (await doImport()).json(), { added: 0, skipped: 1 });

  for (const route of ['/', '/sw.js', '/manifest.webmanifest', '/vendor/ical.js', '/icon-192.png', '/icon-512.png', '/import-help.html']) {
    const result = await request(route);
    assert.equal(result.status, 200, route);
    await result.arrayBuffer();
  }
  const zip = await request('/ustc-import-extension.zip');
  assert.equal(zip.status, 200);
  const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ['dates.js', 'manifest.json', 'popup.css', 'popup.html', 'popup.js', 'school.js']);

  const signout = await request('/api/session', { method: 'DELETE', body: { endpoint: subscription.endpoint }, cookie: phone });
  assert.equal(signout.status, 204);
  assert.equal((await request('/api/events', { cookie: phone })).status, 401);
  assert.equal((await request(eventsUrl, { cookie: desktop })).status, 200);
  assert.equal((await request('/api/devices/test', { method: 'POST', body: { endpoint: subscription.endpoint }, cookie: desktop })).status, 404);
});
