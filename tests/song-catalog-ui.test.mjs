import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';
import { startSongManagementFixture } from './helpers/song-management-fixture.mjs';
import { navigate } from '../scripts/browser-ui.mjs';

const sourceArtwork = 'https://i0.hdslb.com/catalog-source.jpg', directoryArtwork = 'https://p2.music.126.net/catalog-studio.jpg';
const record = { provider: 'netease', id: '100', title: '晴天', artists: ['周杰伦'], album: '叶惠美', artwork: directoryArtwork, url: 'https://music.163.com/song?id=100' };
async function fixture() {
  const provider = { search: async () => [record], records: async () => [record], dispose() {} };
  const f = await startSongManagementFixture({ catalogProvider: provider });
  f.library.execute(f.library.revision(), [
    { type: 'create-song', id: 'catalog-song', title: '【Hi-Res】周杰伦《晴天》', artwork: sourceArtwork, source: 'parsed' },
    { type: 'add-version', version: { id: 'catalog-version', songId: 'catalog-song', ref: { provider: 'bilibili', kind: 'video', id: 'BV0000000009', part: '10' }, label: '音乐会', kind: 'live', facts: { title: '周杰伦《晴天》音乐会现场', artwork: sourceArtwork, uploader: '音乐现场', durationSeconds: 240 }, availability: { state: 'unknown' } } },
    { type: 'favorite', songId: 'catalog-song' },
  ]);
  const favorites = f.library.read().snapshot.favorites;
  f.library.execute(f.library.revision(), [{ type: 'reorder-favorites', favoriteIds: [...favorites.filter(v => v.songId === 'catalog-song'), ...favorites.filter(v => v.songId !== 'catalog-song')].map(v => v.favoriteId) }]);
  return f;
}
async function route(page, origin) {
  await page.route('**/*', async route => {
    const url = route.request().url();
    if ([sourceArtwork, directoryArtwork].includes(url)) return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="${url === directoryArtwork ? '#bfa98c' : '#879eae'}"/><text x="150" y="160" text-anchor="middle" font-size="28">${url === directoryArtwork ? 'Album' : 'Live'}</text></svg>` });
    return new URL(url).origin === origin ? route.continue() : route.abort();
  });
}

test('desktop catalogue matching updates library and live playback without replacing audio; manual selection keeps drafts', { timeout: 60000 }, async t => {
  const f = await fixture(); t.after(f.close);
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(12000); await route(page, f.origin);
  const errors = []; let backfillRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/catalog/backfill')) backfillRequests++; });
  // Keep the background request pending so the source presentation can be played first.
  let resume, started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  await page.route('**/api/song-library/catalog/backfill', async route => { started(); await new Promise(resolve => { resume = resolve; }); await route.continue(); });
  await page.goto(f.origin); await navigate(page, '歌单');
  // Isolate this retained song for the bounded backfill fixture.
  const snapshot = f.library.read().snapshot;
  for (const song of snapshot.songs.filter(s => s.id !== 'catalog-song')) f.library.transaction(f.library.revision(), c => { c.document.snapshot.songs.find(s => s.id === song.id).desktopCatalog = { state: 'disabled', checkedAt: Date.now() }; });
  const row = page.locator('.song-library-row').filter({ has: page.getByRole('button', { name: '播放 【Hi-Res】周杰伦《晴天》', exact: true }) });
  await row.getByRole('button', { name: '播放 【Hi-Res】周杰伦《晴天》', exact: true }).click();
  await page.waitForFunction(() => { const a = document.querySelector('audio'); return a && !a.paused && a.currentTime > .1; });
  const before = await page.locator('audio').evaluate(a => { window.catalogAudio = a; return { source: a.currentSrc, time: a.currentTime }; });
  await startedPromise; resume(); await page.unroute('**/api/song-library/catalog/backfill');
  const canonicalRow = page.locator('.song-library-row').filter({ has: page.getByRole('button', { name: '播放 晴天', exact: true }) }).filter({ has: page.locator(`img[src="${directoryArtwork}"]`) });
  await canonicalRow.waitFor();
  assert.equal(await canonicalRow.locator('img').getAttribute('src'), directoryArtwork);
  await page.waitForFunction(artwork => document.querySelector('.player-bar img')?.getAttribute('src') === artwork || [...document.querySelectorAll('img')].some(img => img.src === artwork && img.closest('footer')), directoryArtwork);
  const after = await page.locator('audio').evaluate(a => ({ same: a === window.catalogAudio, source: a.currentSrc, time: a.currentTime, paused: a.paused }));
  assert.equal(after.same, true); assert.equal(after.source, before.source); assert(after.time >= before.time); assert.equal(after.paused, false);
  await canonicalRow.getByRole('button', { name: /^更多操作 / }).click();
  await page.locator('.song-row-menu [popover]:popover-open').getByRole('button', { name: /^编辑歌曲 / }).click();
  const editor = page.getByRole('dialog', { name: '歌曲与版本', exact: true });
  assert.equal(await editor.locator('.song-editor-heading img').getAttribute('src'), directoryArtwork);
  assert.equal(await editor.locator('.song-version-original img').getAttribute('src'), sourceArtwork);
  const requestsBeforeEditing = backfillRequests;
  await page.waitForTimeout(5500); assert.equal(backfillRequests, requestsBeforeEditing, 'background matching pauses while a dialog is being edited');
  await editor.getByRole('tab', { name: '歌曲资料', exact: true }).click();
  await editor.getByLabel('标准歌名', { exact: true }).fill('我保留的歌名');
  await editor.getByRole('button', { name: '匹配或更换目录资料', exact: true }).click();
  await editor.getByRole('button', { name: '保存并继续', exact: true }).click();
  await editor.getByLabel('目录搜索关键词').fill('晴天 周杰伦'); await editor.getByRole('button', { name: '搜索目录', exact: true }).click();
  await editor.getByRole('button', { name: '采用目录资料 晴天 · 叶惠美', exact: true }).click();
  await editor.getByText('已手动选择网易云目录 · 叶惠美', { exact: true }).waitFor();
  assert.equal(await editor.getByLabel('标准歌名', { exact: true }).inputValue(), '我保留的歌名');
  const stored = f.library.read().snapshot.songs.find(s => s.id === 'catalog-song');
  assert.equal(stored.title, '我保留的歌名'); assert.equal(stored.fields.title.protected, true); assert.equal(stored.defaultVersionId, 'catalog-version');
  const folder = resolve('local/catalog-cover-20261019/screenshots'); await mkdir(folder, { recursive: true });
  await editor.getByRole('button', { name: '匹配或更换目录资料', exact: true }).click();
  await editor.getByRole('button', { name: '搜索目录', exact: true }).click();
  await editor.getByRole('button', { name: '采用目录资料 晴天 · 叶惠美', exact: true }).waitFor();
  await page.screenshot({ path: join(folder, 'catalog-desktop.png') });
  assert.equal(await editor.evaluate(el => el.scrollWidth > el.clientWidth), false);
  for (const [width, height, theme] of [[844, 600, 'light'], [1280, 800, 'dark']]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    assert.equal(await editor.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await editor.getByRole('button', { name: '采用目录资料 晴天 · 叶惠美', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(folder, `catalog-${width}-${theme}.png`) });
  }
  await editor.getByRole('button', { name: '保留来源资料，停止自动匹配', exact: true }).click();
  await editor.getByText('已保留来源资料，自动匹配已停止。', { exact: true }).waitFor();
  assert.equal(await editor.locator('.song-editor-heading img').getAttribute('src'), sourceArtwork);
  assert.deepEqual(errors, []);
});

test('mobile does not start matching and retains source presentation even when desktop catalogue records exist', { timeout: 30000 }, async t => {
  const f = await fixture(); t.after(f.close);
  f.library.transaction(f.library.revision(), c => { c.document.snapshot.songs.find(s => s.id === 'catalog-song').desktopCatalog = { state: 'matched', checkedAt: Date.now(), selection: 'automatic', record }; });
  const browser = await chromium.launch({ channel: 'msedge', headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(10000); await route(page, f.origin);
  const requests = []; page.on('request', request => { if (request.url().includes('/catalog/')) requests.push(request.url()); });
  await page.goto(f.origin); await navigate(page, '歌单');
  const row = page.locator('.song-library-row').filter({ has: page.getByRole('button', { name: '播放 【Hi-Res】周杰伦《晴天》', exact: true }) });
  await row.waitFor(); assert.equal(await row.locator('img').getAttribute('src'), sourceArtwork);
  await page.waitForTimeout(3500); assert.deepEqual(requests, []);
  assert.equal(await page.getByRole('button', { name: '匹配或更换目录资料', exact: true }).count(), 0);
});

for (const sourceCover of [undefined, sourceArtwork]) {
  test(`disabling a catalogue cover restores ${sourceCover ? 'source artwork' : 'a placeholder'} during playback`, { timeout: 30000 }, async t => {
    const f = await startSongManagementFixture({ catalogProvider: { search: async () => [record], records: async () => [record], dispose() {} } }); t.after(f.close);
    f.library.transaction(f.library.revision(), context => {
      for (const song of context.document.snapshot.songs) song.desktopCatalog = song.id === 'sun'
        ? { state: 'matched', checkedAt: Date.now(), selection: 'manual', record }
        : { state: 'disabled', checkedAt: Date.now() };
      if (sourceCover) context.document.snapshot.versions.find(version => version.id === 'studio').facts.artwork = sourceCover;
    });
    const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(8000); await route(page, f.origin);
    let preparations = 0; page.on('request', request => { if (request.url().endsWith('/v1/call/prepare')) preparations++; });
    await page.goto(f.origin); await navigate(page, '歌单');
    await page.getByRole('button', { name: '播放 晴天', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .1);
    assert.equal(await page.locator('.now-playing img').getAttribute('src'), directoryArtwork);
    const before = await page.locator('audio').evaluate(audio => ({ source: audio.currentSrc, time: audio.currentTime })), count = preparations;
    await page.getByRole('button', { name: '歌曲管理', exact: true }).click();
    await page.getByRole('button', { name: '管理歌曲 晴天', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '歌曲与版本', exact: true });
    await editor.getByRole('tab', { name: '歌曲资料', exact: true }).click();
    await editor.getByRole('button', { name: '匹配或更换目录资料', exact: true }).click();
    await editor.getByRole('button', { name: '保留来源资料，停止自动匹配', exact: true }).click();
    await editor.getByText('已保留来源资料，自动匹配已停止。', { exact: true }).waitFor();
    await page.waitForFunction(expected => (document.querySelector('.now-playing img')?.getAttribute('src') ?? null) === expected, sourceCover ?? null);
    assert.deepEqual(await page.evaluate(() => navigator.mediaSession.metadata.artwork.map(item => item.src)), sourceCover ? [sourceCover] : []);
    const after = await page.locator('audio').evaluate(audio => ({ source: audio.currentSrc, time: audio.currentTime, paused: audio.paused }));
    assert.equal(after.source, before.source); assert(after.time >= before.time); assert.equal(after.paused, false); assert.equal(preparations, count);
    await editor.getByRole('button', { name: '返回歌曲管理', exact: true }).click(); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '打开播放队列', exact: true }).click();
    const row = page.locator('.queue-track').filter({ has: page.getByRole('button', { name: '播放队列歌曲 晴天', exact: true }) });
    assert.equal(await row.locator('img').count(), sourceCover ? 1 : 0);
    if (sourceCover) assert.equal(await row.locator('img').getAttribute('src'), sourceCover);
  });
}
