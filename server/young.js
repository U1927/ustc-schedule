import { dayKey } from '../public/dates.js';

const CATALOG = 'https://life-ustc.tiankaima.dev/api/catalog/young-events';
const YOUNG = 'https://young.ustc.edu.cn/';

export function projectCatalog(payload, page) {
  if (!Array.isArray(payload?.data)) throw new Error('活动目录格式错误。');
  const items = [];
  for (const row of payload.data) {
    const title = typeof row.name === 'string' ? row.name.trim().slice(0, 160) : '';
    const starts = typeof row.startAt === 'string' ? Date.parse(row.startAt) : NaN;
    const ends = typeof row.endAt === 'string' ? Date.parse(row.endAt) : NaN;
    if (!title || !Number.isFinite(starts) || !/^[a-f\d]{32}$/i.test(row.youngId) || row.sourceMissing) continue;
    const hasEnd = Number.isFinite(ends) && ends > starts;
    items.push({ title, starts, ends: hasEnd ? ends : starts + 3_600_000,
      place: typeof row.location === 'string' ? row.location.slice(0, 240) : '',
      notes: hasEnd ? '' : '来源未提供结束时间，暂按 1 小时安排。',
      source: 'young', sourceUrl: YOUNG, externalId: `catalog:${row.youngId}`,
      detailUrl: `https://life-ustc.tiankaima.dev/catalog/young-events/${row.youngId}` });
  }
  const synced = payload.meta?.source?.lastSyncedAt;
  return { items, page, more: page < Number(payload.pagination?.totalPages) && page < 100,
    synced: typeof synced === 'string' && Number.isFinite(Date.parse(synced)) ? Date.parse(synced) : null };
}

export async function fetchCatalog(page, fetcher = fetch) {
  const url = new URL(CATALOG);
  url.search = new URLSearchParams({ page, pageSize: 12, active: 'true', dateFrom: dayKey() });
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!response.ok) throw new Error('活动目录暂时不可用。');
  return projectCatalog(await response.json(), page);
}
