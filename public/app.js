import { DAY, at, clockText, dateTimeText, dayKey, localInput, midnight, monthGrid, parseInput, shiftMonth, weekdayText } from './dates.js';
import { parseActivity, parseCourses } from './school.js';

const get = (selector, parent = document) => parent.querySelector(selector);
const all = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const types = { manual: '日程', deadline: '截止事项', jw: '课程', young: '活动', ical: '日程' };
const state = { session: null, selected: dayKey(), month: dayKey(), events: [], request: 0 };
const auth = get('#auth');
const calendar = get('#workspace');
const authForm = get('#auth-form');
const editor = get('#editor');
const eventForm = get('#event-form');
const importer = get('#importer');
const importForm = get('#import-form');
const settings = get('#settings');
const catalog = get('#young-catalog');
const toast = get('#toast');
let toastTimer;
let registering = false;
let editing = null;
let importSource = 'jw';
let pendingImport = [];
let worker;
let catalogPage = 1;
let catalogRequest = 0;

const field = (form, name) => form.elements.namedItem(name);
const dialogError = (form, message = '') => { get('.form-error', form).textContent = message; };

async function api(path, method = 'GET', data) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data)
    });
  } catch {
    throw new Error('无法连接服务器，请检查网络后重试。');
  }
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/session') setSession(null);
    throw Object.assign(new Error(body.error || '操作失败，请重试。'), { status: response.status });
  }
  return body;
}

function notify(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}

function render() {
  const [year, month] = state.month.split('-').map(Number);
  get('#month').textContent = `${year} 年 ${month} 月`;
  const today = dayKey();
  const range = monthGrid(state.month);
  const eventMap = new Map(range.map((date) => [dayKey(date), []]));
  for (const event of state.events) {
    let current = Math.max(range[0], midnight(dayKey(event.starts)));
    const last = Math.min(range.at(-1) + DAY, event.ends);
    while (current < last) {
      eventMap.get(dayKey(current))?.push(event);
      current += DAY;
    }
  }
  const dates = range.map((date) => {
    const key = dayKey(date);
    const events = eventMap.get(key);
    const [y, m, d] = key.split('-').map(Number);
    const button = element('button', 'date');
    button.type = 'button';
    button.dataset.date = key;
    button.classList.toggle('muted', m !== month);
    button.classList.toggle('selected', key === state.selected);
    button.classList.toggle('current', key === today);
    button.setAttribute('aria-label', `${y}年${m}月${d}日，${events.length} 项安排`);
    button.setAttribute('aria-pressed', String(key === state.selected));
    if (key === today) button.setAttribute('aria-current', 'date');
    button.append(element('span', 'day-number', String(d)));
    for (const event of events.slice(0, 2)) {
      const chip = element('span', `calendar-event ${event.source}`, event.title);
      chip.title = event.title;
      chip.setAttribute('aria-hidden', 'true');
      button.append(chip);
    }
    if (events.length > 2) button.append(element('span', 'calendar-count', `+${events.length - 2}`));
    return button;
  });
  const focusedDate = document.activeElement?.dataset.date;
  get('#dates').replaceChildren(...dates);
  if (focusedDate) get(`[data-date="${focusedDate}"]`)?.focus({ preventScroll: true });
  const selectedTime = midnight(state.selected);
  const [, selectedMonth, selectedDay] = state.selected.split('-').map(Number);
  get('#day').textContent = `${selectedMonth} 月 ${selectedDay} 日 · ${weekdayText(selectedTime)}`;
  const items = (eventMap.get(state.selected) || []).map((event) => {
    const li = element('li');
    const button = element('button', `agenda-event ${event.source}`);
    const start = event.starts < selectedTime ? '继续' : clockText(event.starts);
    const end = event.ends > selectedTime + DAY ? '跨天' : clockText(event.ends);
    const timing = event.source === 'deadline' ? `${start} 截止` : `${start}–${end}`;
    button.type = 'button';
    button.dataset.event = event.id;
    button.append(element('small', '', `${types[event.source]} · ${timing}`), element('strong', '', event.title));
    if (event.place) button.append(element('small', '', event.place));
    li.append(button);
    return li;
  });
  const focusedEvent = document.activeElement?.dataset.event;
  get('#agenda-items').replaceChildren(...items);
  if (focusedEvent) get(`[data-event="${focusedEvent}"]`)?.focus({ preventScroll: true });
  get('#empty').hidden = items.length > 0;
}

async function syncEvents({ quiet = false } = {}) {
  if (!state.session) return;
  const request = ++state.request;
  const days = monthGrid(state.month);
  try {
    const events = await api(`/events?from=${days[0]}&to=${days.at(-1) + DAY}`);
    if (request !== state.request) return;
    if (JSON.stringify(events) !== JSON.stringify(state.events)) {
      state.events = events;
      render();
    }
    get('#sync').textContent = '已同步';
  } catch (error) {
    if (request !== state.request) return;
    get('#sync').textContent = '同步待重试';
    if (!quiet) notify(error.message);
  }
}

function selectDay(key) {
  const sameMonth = state.month.slice(0, 7) === key.slice(0, 7);
  state.selected = key;
  state.month = key;
  render();
  if (!sameMonth) void syncEvents();
}

function setSession(session) {
  const signedIn = Boolean(session?.handle);
  state.session = signedIn ? session : null;
  auth.hidden = signedIn;
  calendar.hidden = !signedIn;
  if (signedIn) {
    get('#handle').textContent = session.handle;
    get('#avatar').textContent = session.handle[0].toUpperCase();
    get('#sync').textContent = '正在连接…';
    render();
    void syncEvents();
    void openLinkedEvent();
  } else {
    state.request++;
    state.events = [];
    for (const dialog of [editor, importer, settings, catalog]) if (dialog.open) dialog.close();
    get('#agenda-items').replaceChildren();
    get('#dates').replaceChildren();
  }
}

function setRegisterMode(value) {
  registering = value;
  get('#auth-title').textContent = value ? '创建科大日程账号' : '登录科大日程';
  get('#auth-submit').textContent = value ? '创建账号' : '登录';
  get('#auth-switch').textContent = value ? '已有账号，返回登录' : '创建账号';
  field(authForm, 'password').autocomplete = value ? 'new-password' : 'current-password';
  dialogError(authForm);
}

let sessionInfo;
async function initialize() {
  try {
    sessionInfo = await api('/session');
    get('#auth-switch').hidden = !sessionInfo.signup;
    setSession(sessionInfo);
  } catch (error) {
    dialogError(authForm, error.message);
  }
}
get('#auth-switch').addEventListener('click', () => setRegisterMode(!registering));
authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = get('#auth-submit');
  submit.disabled = true;
  dialogError(authForm);
  try {
    const { handle, password } = Object.fromEntries(new FormData(authForm));
    const account = await api('/session', 'POST', { handle, password, register: registering });
    authForm.reset();
    setRegisterMode(false);
    if (!sessionInfo) sessionInfo = await api('/session');
    setSession(account);
  } catch (error) {
    dialogError(authForm, error.message);
  } finally {
    submit.disabled = false;
  }
});

function editorFields() {
  const deadline = field(eventForm, 'source').value === 'deadline';
  const ends = field(eventForm, 'ends');
  get('#start-label').textContent = deadline ? '截止时间' : '开始时间';
  get('#end-field').hidden = deadline;
  ends.required = !deadline;
  ends.disabled = deadline;
  const custom = field(eventForm, 'preset').value === 'custom';
  get('#custom-field').hidden = !custom;
  field(eventForm, 'custom').required = custom;
}

function openEditor(event = null, source = 'manual') {
  editing = event;
  eventForm.reset();
  dialogError(eventForm);
  const date = state.selected;
  const now = Math.ceil(Date.now() / 1_800_000) * 1_800_000;
  const starts = event?.starts ?? (date === dayKey() && dayKey(now) === date ? now : at(date, '09:00'));
  field(eventForm, 'title').value = event?.title || '';
  field(eventForm, 'source').value = event?.source === 'deadline' ? 'deadline' : source;
  field(eventForm, 'starts').value = localInput(starts);
  field(eventForm, 'ends').value = localInput(event?.ends ?? starts + 3_600_000);
  field(eventForm, 'place').value = event?.place || '';
  field(eventForm, 'notes').value = event?.notes || '';
  const rawReminder = event?.reminder ?? (event ? null : source === 'deadline' ? 60 : 15);
  const preset = field(eventForm, 'preset');
  const selected = rawReminder === null ? '' : String(rawReminder);
  preset.value = [...preset.options].some((option) => option.value === selected) ? selected : 'custom';
  if (preset.value === 'custom') field(eventForm, 'custom').value = selected;
  get('#editor-title').textContent = event ? `编辑${types[event.source]}` : source === 'deadline' ? '新建截止事项' : '新建日程';
  get('#type-field').hidden = Boolean(event && !['manual', 'deadline'].includes(event.source));
  get('#delete-event').hidden = !event;
  const original = get('#original');
  original.hidden = !event?.sourceUrl;
  if (event?.sourceUrl) original.href = event.sourceUrl;
  else original.removeAttribute('href');
  editorFields();
  editor.showModal();
}

field(eventForm, 'source').addEventListener('change', editorFields);
field(eventForm, 'preset').addEventListener('change', editorFields);
field(eventForm, 'starts').addEventListener('change', () => {
  const start = parseInput(field(eventForm, 'starts').value);
  const ends = field(eventForm, 'ends');
  if (Number.isFinite(start) && (!ends.value || parseInput(ends.value) <= start)) ends.value = localInput(start + 3_600_000);
});
eventForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  const data = Object.fromEntries(new FormData(eventForm));
  const starts = parseInput(data.starts);
  const ends = data.source === 'deadline' ? starts + 60_000 : parseInput(data.ends);
  const reminder = data.preset === 'custom' ? Number(data.custom) : data.preset === '' ? null : Number(data.preset);
  const body = { title: data.title, source: data.source, starts, ends, reminder, place: data.place, notes: data.notes, version: editing?.version };
  submit.disabled = true;
  dialogError(eventForm);
  try {
    await api(editing ? `/events/${editing.id}` : '/events', editing ? 'PUT' : 'POST', body);
    editor.close();
    selectDay(dayKey(starts));
    await syncEvents();
    notify(data.source === 'deadline' ? '截止事项已保存' : '日程已保存');
  } catch (error) {
    if (error.status === 409) void syncEvents({ quiet: true });
    dialogError(eventForm, error.message);
  } finally {
    submit.disabled = false;
  }
});
get('#delete-event').addEventListener('click', async (event) => {
  if (!editing || !window.confirm(`删除「${editing.title}」？`)) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api(`/events/${editing.id}?version=${editing.version}`, 'DELETE');
    editor.close();
    await syncEvents();
    notify('日程已删除');
  } catch (error) {
    if (error.status === 409) void syncEvents({ quiet: true });
    dialogError(eventForm, error.message);
  } finally {
    button.disabled = false;
  }
});

async function openLinkedEvent() {
  const url = new URL(location.href);
  const id = url.searchParams.get('event');
  if (!id || !/^[a-f\d-]{36}$/i.test(id)) return;
  url.searchParams.delete('event');
  history.replaceState(null, '', url);
  try {
    const event = await api(`/events/${id}`);
    selectDay(dayKey(event.starts));
    openEditor(event);
  } catch (error) {
    notify(error.message);
  }
}

function resetPreview() {
  pendingImport = [];
  get('#preview').hidden = true;
  get('#commit-import').hidden = true;
  get('#import-list').replaceChildren();
}

async function showCatalogPage(page) {
  const request = ++catalogRequest;
  const status = get('#catalog-status');
  const list = get('#catalog-items');
  const prev = get('#catalog-prev');
  const next = get('#catalog-next');
  list.replaceChildren();
  prev.hidden = true;
  next.hidden = true;
  status.textContent = '正在读取活动目录…';
  try {
    const result = await api(`/campus/young?page=${page}`);
    if (request !== catalogRequest) return;
    catalogPage = result.page;
    status.textContent = [result.items.length ? '青春科大活动 · Life@USTC 公开镜像' : '本页暂无可添加的活动',
      result.synced ? `数据更新于 ${dateTimeText(result.synced)}` : ''].filter(Boolean).join(' · ');
    prev.hidden = result.page <= 1;
    next.hidden = !result.more;
    list.replaceChildren(...result.items.map((row) => {
      const item = element('li', 'catalog-item');
      const info = element('div');
      const link = element('a', '', '查看活动详情');
      link.href = row.detailUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      info.append(element('strong', '', row.title),
        element('p', '', `${dateTimeText(row.starts)}${row.place ? ` · ${row.place}` : ''}`), link);
      const add = element('button', 'button primary', '添加');
      add.type = 'button';
      add.setAttribute('aria-label', `添加 ${row.title}`);
      add.addEventListener('click', async () => {
        const reminder = get('#catalog-reminder');
        if (!reminder.reportValidity()) return;
        add.disabled = true;
        try {
          const saved = await api('/import', 'POST', { events: [{ ...row, reminder: reminder.value === '' ? null : Number(reminder.value) }] });
          add.textContent = saved.added ? '已添加' : '已在日历';
          selectDay(dayKey(row.starts));
          void syncEvents({ quiet: true });
        } catch (error) {
          add.disabled = false;
          status.textContent = error.message;
        }
      });
      item.append(info, add);
      return item;
    }));
  } catch (error) {
    if (request !== catalogRequest) return;
    status.textContent = error.message;
    prev.hidden = page <= 1;
    catalogPage = page;
  }
}

get('#catalog-prev').addEventListener('click', () => showCatalogPage(catalogPage - 1));
get('#catalog-next').addEventListener('click', () => showCatalogPage(catalogPage + 1));
get('#direct-activity').addEventListener('click', () => {
  catalog.close();
  openImport('young');
});

function openImport(source) {
  importSource = source;
  importForm.reset();
  resetPreview();
  dialogError(importForm);
  get('#import-title').textContent = source === 'jw' ? '导入教务课表' : '添加校园活动';
  get('#jw-help').hidden = source !== 'jw';
  get('#young-help').hidden = source !== 'young';
  importer.showModal();
}
for (const name of ['file', 'term', 'content', 'sourceUrl']) field(importForm, name).addEventListener('input', resetPreview);
importForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  dialogError(importForm);
  submit.disabled = true;
  try {
    if (submit.value === 'commit' && pendingImport.length) {
      const value = field(importForm, 'reminder').value;
      const chosen = pendingImport.map((row) => ({ ...row, reminder: value === '' ? null : Number(value) }));
      const result = await api('/import', 'POST', { events: chosen });
      importer.close();
      const today = midnight(dayKey());
      selectDay(dayKey((chosen.find((row) => row.starts >= today) || chosen[0]).starts));
      await syncEvents();
      notify(`已添加 ${result.added} 项${result.skipped ? `，跳过 ${result.skipped} 项重复记录` : ''}。`);
      return;
    }
    resetPreview();
    const file = field(importForm, 'file').files[0];
    if (file?.size > 4_000_000) throw new Error('文件过大，请选择 4 MB 以内的文件。');
    let missing = 0;
    if (file && /\.ics$/i.test(file.name)) {
      const [{ parseCalendar }, { default: ICAL }] = await Promise.all([import('./ical-import.js'), import('/vendor/ical.js')]);
      pendingImport = parseCalendar(ICAL, await file.text(), importSource === 'jw');
    } else if (importSource === 'jw') {
      if (!file) throw new Error('请选择课表文件。');
      ({ events: pendingImport, missing } = parseCourses(JSON.parse(await file.text()), field(importForm, 'term').value));
    } else {
      const input = file ? JSON.parse(await file.text()) : field(importForm, 'content').value;
      pendingImport = [parseActivity(input, field(importForm, 'sourceUrl').value)];
    }
    if (pendingImport.length > 2500) throw new Error('一次最多导入 2500 项。');
    const preview = pendingImport.slice(0, 30).map((row) => {
      const li = element('li', '', `${dateTimeText(row.starts)} · ${row.title}${row.place ? ` · ${row.place}` : ''}`);
      if (row.notes && row.source === 'young') li.append(element('p', 'hint', row.notes));
      return li;
    });
    get('#import-list').replaceChildren(...preview);
    get('#import-summary').textContent = `识别到 ${pendingImport.length} 项${missing ? `，有 ${missing} 门课程未识别` : ''}${pendingImport.length > 30 ? '。下方显示前 30 项' : ''}。`;
    get('#preview').hidden = false;
    get('#commit-import').hidden = false;
  } catch (error) {
    dialogError(importForm, error instanceof SyntaxError ? '文件格式无法读取，请重新下载或检查文件。' : error.message);
  } finally {
    submit.disabled = false;
  }
});

const subscribeSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function deviceSubscription() {
  return worker ? (await worker).pushManager.getSubscription() : null;
}
async function updatePushStatus() {
  const subscription = await deviceSubscription().catch(() => null);
  const active = subscription && Notification.permission === 'granted';
  get('#push-on').hidden = !subscribeSupported || active;
  get('#push-test').hidden = !active;
  get('#push-off').hidden = !active;
  get('#push-status').textContent = active ? '此浏览器已订阅提醒。' : !subscribeSupported
    ? '当前浏览器环境无法开启推送。请使用 HTTPS，并在 iPhone 上从主屏幕打开。'
    : Notification.permission === 'denied' ? '系统已禁止通知，可在浏览器设置中修改。' : '此设备尚未开启提醒。';
}
function settingsAction(id, handler) {
  get(id).addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    dialogError(settings);
    try {
      await handler();
      if (settings.open) await updatePushStatus();
    } catch (error) {
      dialogError(settings, error.message);
    } finally {
      button.disabled = false;
    }
  });
}
settingsAction('#push-on', async () => {
  if (!worker || !sessionInfo?.pushKey) throw new Error('推送尚未就绪，请刷新后重试。');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('请允许此应用发送通知。');
  const reg = await worker;
  const key = Uint8Array.from(atob(sessionInfo.pushKey.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
  const existing = await reg.pushManager.getSubscription();
  const subscription = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  try {
    await api('/devices', 'POST', subscription.toJSON());
  } catch (error) {
    if (!existing) await subscription.unsubscribe();
    throw error;
  }
  notify('此设备已开启提醒');
});
settingsAction('#push-off', async () => {
  const subscription = await deviceSubscription();
  if (subscription) {
    await api('/devices', 'DELETE', { endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  }
  notify('此设备已关闭提醒');
});
settingsAction('#push-test', async () => {
  const subscription = await deviceSubscription();
  if (!subscription) throw new Error('请先开启此设备提醒。');
  await api('/devices', 'POST', subscription.toJSON());
  await api('/devices/test', 'POST', { endpoint: subscription.endpoint });
  notify('测试提醒已发送');
});
settingsAction('#sign-out', async () => {
  const subscription = await deviceSubscription().catch(() => null);
  await api('/session', 'DELETE', subscription ? { endpoint: subscription.endpoint } : undefined);
  if (subscription) await subscription.unsubscribe().catch(() => {});
  setSession(null);
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-close')) button.closest('dialog').close();
  if (button.dataset.date) selectDay(button.dataset.date);
  if (button.dataset.event) {
    const item = state.events.find((row) => row.id === button.dataset.event);
    if (item) openEditor(item);
  }
  if (button.dataset.import === 'jw') openImport('jw');
  if (button.dataset.import === 'young') {
    catalog.showModal();
    get('#catalog-reminder').value = '';
    void showCatalogPage(1);
  }
  switch (button.dataset.action) {
    case 'calendar': window.scrollTo({ top: 0 }); break;
    case 'prev': selectDay(shiftMonth(state.month, -1)); break;
    case 'next': selectDay(shiftMonth(state.month, 1)); break;
    case 'today': selectDay(dayKey()); break;
    case 'new': openEditor(); break;
    case 'deadline': openEditor(null, 'deadline'); break;
    case 'settings':
      dialogError(settings);
      settings.showModal();
      void updatePushStatus();
      break;
  }
});
window.addEventListener('focus', () => syncEvents({ quiet: true }));
window.addEventListener('online', () => syncEvents({ quiet: true }));
setInterval(() => { if (!document.hidden) void syncEvents({ quiet: true }); }, 15_000);
if ('serviceWorker' in navigator) {
  worker = navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready);
  worker.catch(() => {});
}
void initialize();
