import { preferenceStorage } from './preference-storage';
import type { ChartKind, ChartSource, MusicChart } from '../server/chart-types';

const storageKey = 'slow-listening:charts:v1';
const entries = new Map<string, MusicChart>();
let restored = false;
const key = (source: ChartSource, chart: ChartKind, period = 'latest') => `${source}:${chart}:${source === 'bilibili' ? period : ''}`;

function restore() {
  if (restored) return;
  restored = true;
  try {
    const saved: unknown = JSON.parse(preferenceStorage().getItem(storageKey) ?? '[]');
    if (!Array.isArray(saved)) return;
    for (const row of saved.slice(-32)) {
      if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
      const value = row[1] as MusicChart | undefined;
      if (!value || !['netease','qq','bilibili','apple'].includes(value.source) || !['hot','new','rising','most-played'].includes(value.chart) ||
          typeof value.title !== 'string' || typeof value.sourceUrl !== 'string' || !Number.isFinite(value.fetchedAt) || !Number.isFinite(value.refreshAfter) ||
          !Array.isArray(value.items) || !value.items.length || !value.items.every(item => item && typeof item.title === 'string' && Number.isSafeInteger(item.rank))) continue;
      entries.set(row[0], value);
    }
  } catch { /* Storage is optional; the in-memory cache still works. */ }
}

export function cachedChart(source: ChartSource, chart: ChartKind, period = 'latest'): MusicChart | undefined {
  restore();
  return entries.get(key(source, chart, period));
}

export function cacheChart(value: MusicChart, period = 'latest') {
  restore();
  // An older service does not provide a freshness contract. Keep using its API.
  if (!Number.isFinite(value.refreshAfter)) return;
  if (value.source === 'bilibili') {
    for (const [id, existing] of entries) {
      if (existing.source !== 'bilibili') continue;
      if (id.endsWith(':latest') && existing.period?.id !== value.periods?.[0]?.id) entries.delete(id);
      else entries.set(id, {...existing, periods: value.periods, refreshAfter: value.refreshAfter});
    }
  }
  const put = (id: string) => {entries.delete(id); entries.set(id, value);};
  put(key(value.source, value.chart, period));
  if (value.period) put(key(value.source, value.chart, String(value.period.id)));
  while (entries.size > 32) entries.delete(entries.keys().next().value!);
  try {preferenceStorage().setItem(storageKey, JSON.stringify([...entries]));} catch { /* Quota or disabled storage must not prevent browsing. */ }
}
