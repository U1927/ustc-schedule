import { courseLessons, parseActivity, youngSource } from './school.js';

async function readCourses() {
  const page = new URL(location.href);
  const student = page.pathname.match(/^\/for-std\/course-table\/(?:info\/)?(\d+)\/?$/)?.[1];
  if (!student) throw new Error('请先登录，并打开教务系统的「我的课表」。');
  const observed = performance.getEntriesByType('resource').map((entry) => new URL(entry.name)).findLast((url) =>
    url.origin === page.origin && url.pathname === '/for-std/course-table/get-data'
    && url.searchParams.get('dataId') === student && /^\d+$/.test(url.searchParams.get('semesterId') || ''));
  const control = document.querySelector('select[name="semesterId"], select#semesterId, select[id*="semester" i]');
  const query = observed?.searchParams.get('semesterId') || control?.value || page.searchParams.get('semesterId');
  if (!/^\d+$/.test(query || '')) throw new Error('未识别到学期，请重新选择当前学期并等待课表加载。');
  const url = new URL('/for-std/course-table/get-data', page);
  url.search = new URLSearchParams({ bizTypeId: '2', semesterId: query, dataId: student });
  const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('教务系统未返回课表，请刷新并确认登录仍有效。');
  const payload = await response.json();
  const snapshot = ['studentTableVm', 'lessonId2Lesson', 'lessons', 'lessonIds', 'activities', 'schedules'].reduce((result, key) => {
    if (payload[key] !== undefined) result[key] = payload[key];
    return result;
  }, {});
  const semester = payload.semester ?? payload.studentTableVm?.semester;
  return { snapshot, monday: semester?.startDate || '' };
}

function readActivity() {
  if (/^\/(?:nginx_auth|login|logout)(?:\/|\.php|$)/i.test(location.pathname)) {
    throw new Error('请先在青春科大完成登录，再打开活动详情。');
  }
  const article = document.querySelector('article, main, [role="main"], .activity-detail, .event-detail, .content');
  const root = article || document.body;
  const heading = root.querySelector('h1, h2, .activity-title, .event-title')?.textContent?.trim();
  const title = /^(青春科大|第二课堂|活动详情)$/.test(heading || '') ? '' : heading;
  return { title, text: (window.getSelection()?.toString().trim() || root.innerText).slice(0, 35_000), url: location.href };
}

const button = document.querySelector('#capture');
const status = document.querySelector('#status');
button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = '正在读取…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    const school = url.origin === 'https://jw.ustc.edu.cn';
    if (!school && url.origin !== 'https://young.ustc.edu.cn') throw new Error('请先打开学校指定站点。');
    const capture = school ? readCourses : readActivity;
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: capture });
    if (!result) throw new Error('没有读取到日程，请确认当前页已加载。');
    let file;
    if (school) {
      const lessons = courseLessons(result.snapshot);
      if (!lessons.length) throw new Error('这个学期没有可导出的课程。');
      const stamp = String(result.monday).slice(0, 10);
      const monday = Date.parse(`${stamp}T00:00:00Z`);
      file = { kind: 'ustc-courses', monday: Number.isFinite(monday) && new Date(monday).getUTCDay() === 1 ? stamp : '', lessons };
    } else {
      const sourceUrl = youngSource(result.url);
      const event = parseActivity(result, sourceUrl);
      file = { kind: 'ustc-activity', url: sourceUrl, title: event.title, starts: event.starts, ends: event.ends,
        place: event.place, notes: event.notes };
    }
    const link = document.createElement('a');
    const blob = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    link.href = blob;
    link.download = school ? 'ustc-courses.json' : 'ustc-activity.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(blob), 2000);
    status.textContent = '已生成文件。回到科大日程上传并预览。';
  } catch (error) {
    const message = error?.message || '读取失败，请确认已登录并刷新学校网页。';
    status.textContent = message.startsWith('Error: ') ? message.slice(7) : message;
  } finally {
    button.disabled = false;
  }
});
