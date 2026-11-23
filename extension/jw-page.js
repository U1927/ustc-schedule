export async function readCourses({
  location = globalThis.location, performance = globalThis.performance,
  document = globalThis.document, fetch = globalThis.fetch
} = {}) {
  const page = new URL(location.href);
  const student = page.pathname.match(/^\/for-std\/course-table\/(?:info\/)?(\d+)\/?$/)?.[1];
  if (page.origin !== 'https://jw.ustc.edu.cn' || !student) {
    throw new Error('请先登录，并打开教务系统的「我的课表」。');
  }
  const observed = performance.getEntriesByType('resource').map((entry) => new URL(entry.name)).findLast((url) =>
    url.origin === page.origin && url.pathname === '/for-std/course-table/get-data'
    && url.searchParams.get('dataId') === student && /^\d+$/.test(url.searchParams.get('semesterId') || ''));
  const control = document.querySelector('select[name="semesterId"], select#semesterId, select[id*="semester" i]');
  const semesterId = observed?.searchParams.get('semesterId') || control?.value || page.searchParams.get('semesterId');
  if (!/^\d+$/.test(semesterId || '')) throw new Error('未识别到学期，请重新选择当前学期并等待课表加载。');
  const url = new URL('/for-std/course-table/get-data', page);
  url.search = new URLSearchParams({
    bizTypeId: observed?.searchParams.get('bizTypeId') || '2', semesterId, dataId: student
  });
  const schoolRequest = { credentials: 'same-origin', redirect: 'error' };
  const response = await fetch(url, { ...schoolRequest, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('教务系统未返回选课名单，请刷新并确认登录仍有效。');
  const snapshot = await response.json();
  const table = snapshot.studentTableVm ?? snapshot;
  const array = (...items) => items.find((item) => Array.isArray(item) && item.length) ?? [];
  const ids = array(table.lessonIds, snapshot.lessonIds, array(table.lessons, snapshot.lessons).map((lesson) => lesson?.id),
    Object.keys(snapshot.lessonId2Lesson ?? {}));
  const lessonIds = [...new Set(ids.map(String).filter((id) => /^\d+$/.test(id)))];
  const monday = (snapshot.semester ?? table.semester)?.startDate || '';
  if (!lessonIds.length) return { snapshot, monday };
  try {
    const schedule = await fetch(new URL('/ws/schedule-table/datum', page), {
      ...schoolRequest,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ lessonIds }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!schedule.ok) return { snapshot, monday, scheduleStatus: schedule.status };
    const datum = await schedule.json();
    return { snapshot, datum, monday };
  } catch {
    return { snapshot, monday, scheduleStatus: 0 };
  }
}
