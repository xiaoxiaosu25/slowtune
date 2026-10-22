import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import { startSongManagementFixture } from './helpers/song-management-fixture.mjs';
import { navigate } from '../scripts/browser-ui.mjs';

// Timing assertions run alone through scripts/verify-song-management-performance.mjs.
test('large desktop song management stays responsive during media clock updates', { timeout: 90000, skip: !process.env.MUSIC_APP_PERF_VERIFY && !process.env.MUSIC_APP_PERF_BASELINE }, async t => {
  const fixture = await startSongManagementFixture({ clientRoot: process.env.MUSIC_APP_PERF_CLIENT_ROOT }); t.after(fixture.close);
  const library = structuredClone(fixture.library.read()), sample = library.snapshot.versions[0];
  for (let i = 0; i < 5000; i++) {
    const id = 'probe-' + i;
    library.snapshot.songs.push({ ...library.snapshot.songs[0], id, title: '性能探测歌曲 ' + i, defaultVersionId: id + '-v0' });
    library.snapshot.favorites.push({ ...library.snapshot.favorites[0], favoriteId: 'f-' + id, songId: id });
    for (let v = 0; v < 4; v++) library.snapshot.versions.push({ ...sample, id: id + '-v' + v, songId: id, ref: { ...sample.ref, part: String(1000 + i * 4 + v) } });
  }
  for (let p = 0; p < 100; p++) library.snapshot.playlists.push({ ...library.snapshot.playlists[0], id: 'p-' + p, name: '探测歌单 ' + p, entries: Array.from({ length: 500 }, (_, e) => ({ ...library.snapshot.playlists[0].entries[0], entryId: 'e-' + p + '-' + e, songId: 'probe-' + ((p * 50 + e) % 5000) })) });
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== fixture.origin) return route.abort();
    if (url.pathname === '/api/song-library') return route.fulfill({ json: library });
    if (url.pathname === '/api/song-library/events') return route.fulfill({ json: { revision: library.revision } });
    return route.continue();
  });
  await page.addInitScript(() => {
    window.managementLongTasks = [];
    window.slowTuneRenderCounts={};
    new PerformanceObserver(list => window.managementLongTasks.push(...list.getEntries().map(entry => Math.round(entry.duration)))).observe({ type: 'longtask' });
  });
  await page.goto(fixture.origin); await navigate(page, '歌单');
  const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const opens = [], searches = [];
  const manager = page.getByRole('dialog', { name: '歌曲管理', exact: true });
  for (let run = 0; run < 5; run++) {
    // Measure actual click-to-paint latency; exclude Playwright's accessibility lookup cost.
    opens.push(await page.evaluate(async () => {
      const start = performance.now(); document.querySelector('.page-actions>button').click();
      await new Promise(resolve => { const ready = () => document.querySelector('dialog[open] .song-manager-row') ? requestAnimationFrame(resolve) : requestAnimationFrame(ready); requestAnimationFrame(ready); });
      return performance.now() - start;
    }));
    assert.equal(await manager.locator('.song-manager-row').count(), 30);
    if (!process.env.MUSIC_APP_PERF_BASELINE) assert.equal(await manager.locator('.song-manager-version').count(), 0);
    searches.push(await page.evaluate(async () => {
      const start = performance.now(), input = document.querySelector('[aria-label="搜索已保存歌曲"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '性能探测歌曲 4999');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => { const ready = () => document.querySelector('.song-manager-open')?.textContent.includes('性能探测歌曲 4999') ? requestAnimationFrame(resolve) : requestAnimationFrame(ready); requestAnimationFrame(ready); });
      return performance.now() - start;
    }));
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: '播放 晴天', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .2);
  await page.getByRole('button', { name: '歌曲管理', exact: true }).click(); await manager.waitFor();
  await page.waitForTimeout(300); await page.evaluate(() => { window.managementLongTasks = [];window.slowTuneRenderCounts={}; });
  await page.waitForTimeout(1800);
  const clockTasks = await page.evaluate(() => window.managementLongTasks);
  const clockComponentRenders=await page.evaluate(()=>window.slowTuneRenderCounts);
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const report = { songs: library.snapshot.songs.length, versions: library.snapshot.versions.length, playlistEntries: 50002, cpuSlowdown: 4, opens, searches, openMedianMs: median(opens), searchMedianMs: median(searches), clockTasks,clockComponentRenders, baseline: { openMs: 582.6, searchMs: 110.6, clockTaskMs: [182, 170, 199, 163, 172, 204] } };
  const artifacts = resolve(process.env.MUSIC_APP_PERF_ARTIFACTS??'local/verification/song-management-performance'); await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, process.env.MUSIC_APP_PERF_BASELINE ? 'baseline-report.json' : 'report.json'), JSON.stringify(report, null, 2));
  t.diagnostic(JSON.stringify(report));
  if (process.env.MUSIC_APP_PERF_BASELINE) return;
  assert(report.openMedianMs <= report.baseline.openMs * .4, 'opening is at least 60% faster than the measured baseline');
  assert(report.searchMedianMs <= report.baseline.searchMs * .4, 'search is at least 60% faster than the measured baseline');
  assert(clockTasks.filter(duration => duration >= 100).length <= 1, 'media clock updates do not cause repeated 100 ms tasks');
  assert.deepEqual(errors, []);
});
