import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import { startSongManagementFixture } from './helpers/song-management-fixture.mjs';
import { navigate, libraryAction } from '../scripts/browser-ui.mjs';
import { entry, ref } from './helpers/song-services.mjs';

test('desktop feedback stays in the player or active dialog and preserves recovery actions', { timeout: 90000 }, async t => {
  const fixture = await startSongManagementFixture(); t.after(fixture.close);
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  let failPrepare = false, failWrite = false, failMetadata = false, gate, requested;
  await page.route('**/v1/call/prepare', async route => {
    if (gate) { const wait = gate; requested?.(); await wait; }
    if (failPrepare) return route.fulfill({ status: 503, json: { protocol: 2, error: { code: 'network', retryable: true } } }).catch(() => {});
    return route.continue().catch(() => {});
  });
  await page.route('**/api/song-library/edits', route => failWrite ? route.fulfill({ status: 503, json: { error: { code: 'storage' } } }) : route.continue());
  await page.route('**/v1/call/metadata', route => failMetadata ? route.fulfill({ status: 503, json: { protocol: 2, error: { code: 'network' } } }) : route.continue());
  const artifacts = resolve('local/verification/desktop-feedback'); await mkdir(artifacts, { recursive: true });
  await page.goto(fixture.origin); await navigate(page, '歌单');
  const libraryTop = () => page.locator('.list-view').evaluate(element => element.getBoundingClientRect().top);
  const beforeTop = await libraryTop();
  const issueButton = () => page.getByRole('button', { name: '播放失败，查看详情', exact: true });
  const issuePanel = () => page.locator('.playback-feedback-popover [popover]:popover-open');
  const noBanner = async () => assert.equal(await page.locator('.main-content>.feedback').count(), 0);
  let release;
  gate = new Promise(resolve => { release = resolve; }); t.after(() => release?.());
  const pending = new Promise(resolve => { requested = resolve; });
  await page.getByRole('button', { name: '播放 晴天', exact: true }).click(); await pending;
  await page.getByRole('button', { name: '取消播放准备', exact: true }).waitFor();
  await noBanner(); assert.equal(await libraryTop(), beforeTop);
  await page.getByRole('button', { name: '取消播放准备', exact: true }).click(); release(); gate = undefined;
  await page.waitForFunction(() => document.querySelector('.play-toggle')?.getAttribute('aria-busy') === 'false');
  assert.equal(await issueButton().count(), 0);

  failPrepare = true;
  await page.getByRole('button', { name: '播放 晴天', exact: true }).click(); await issueButton().waitFor();
  await noBanner(); assert.equal(await libraryTop(), beforeTop);
  for (const style of ['bar', 'floating']) {
    await page.getByRole('button', { name: '更多播放选项', exact: true }).click();
    await page.getByRole('radio', { name: style === 'bar' ? '底部长条' : '悬浮播放岛', exact: true }).check(); await page.keyboard.press('Escape');
    for (const width of [1440, 1280, 1050, 960, 761]) {
      await page.setViewportSize({ width, height: 1000 });
      const overlaps = await issueButton().evaluate(button => {
        const a = button.getBoundingClientRect();
        return [...document.querySelectorAll('.playbar .mode-control,.playbar .transport button')].some(control => {
          const b = control.getBoundingClientRect(); return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        });
      });
      assert.equal(overlaps, false, `${style} at ${width}px keeps playback controls unobstructed`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await issueButton().click(); await issuePanel().getByRole('button', { name: '重试播放', exact: true }).waitFor();
  await page.screenshot({ path: resolve(artifacts, 'player-error-details.png') });
  await page.keyboard.press('Escape');
  assert.equal(await issueButton().evaluate(element => element === document.activeElement), true);
  await issueButton().click(); failPrepare = false;
  await issuePanel().getByRole('button', { name: '重试播放', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .2);
  assert.equal(await issueButton().count(), 0, 'first preparation retry replays the failed request even with an empty previous queue');

  const current = await page.locator('audio').evaluate(audio => ({ source: audio.currentSrc, time: audio.currentTime }));
  failPrepare = true;
  await page.getByRole('button', { name: '播放 晴天（重复保存）', exact: true }).click(); await issueButton().waitFor();
  await page.waitForTimeout(600);
  const retained = await page.locator('audio').evaluate(audio => ({ source: audio.currentSrc, time: audio.currentTime, paused: audio.paused }));
  assert.equal(retained.source, current.source); assert.equal(retained.paused, false); assert(retained.time > current.time);
  await noBanner(); assert.equal(await libraryTop(), beforeTop);
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await page.locator('.listening-transport').getByRole('button', { name: '播放失败，查看详情', exact: true }).waitFor();
  await page.getByRole('button', { name: '打开沉浸歌词', exact: true }).click();
  await page.locator('.desktop-lyrics-controls').getByRole('button', { name: '播放失败，查看详情', exact: true }).waitFor();
  assert.equal(await issueButton().count(), 1);
  await page.getByRole('button', { name: '关闭沉浸歌词', exact: true }).click();
  await page.getByRole('button', { name: '返回浏览音乐', exact: true }).click();
  await libraryAction(page, '歌曲管理');
  const manager = page.getByRole('dialog', { name: '歌曲管理', exact: true });
  await page.screenshot({ path: resolve(artifacts, 'manager-player-feedback.png') });
  await manager.getByRole('button', { name: '播放失败，查看详情', exact: true }).click();
  await issuePanel().getByRole('button', { name: '关闭提示', exact: true }).click();
  assert.equal(await issueButton().count(), 0);
  assert.equal(await manager.locator('.song-manager-version').count(), 0, 'collapsed versions are not mounted');
  await manager.locator('.song-manager-versions').first().locator('summary').click();
  await manager.locator('.song-manager-version').first().waitFor();
  await manager.getByRole('button', { name: '管理歌曲 晴天', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '歌曲与版本', exact: true });
  await editor.getByRole('tab', { name: '歌曲资料', exact: true }).click();
  await editor.getByLabel('标准歌名', { exact: true }).fill('保存失败的草稿'); failWrite = true;
  await editor.getByRole('button', { name: '保存更改', exact: true }).click();
  await editor.getByRole('alert').waitFor();
  assert.equal(await page.locator('.desktop-operation-feedback').count(), 0);
  assert.equal(await editor.getByLabel('标准歌名', { exact: true }).inputValue(), '保存失败的草稿');
  failWrite = false; await editor.getByRole('button', { name: '保存更改', exact: true }).click();
  await editor.getByText('更改已保存。', { exact: true }).waitFor();
  assert.equal(await page.locator('.toast').count(), 0, 'local save feedback is not duplicated as a global toast');
  await page.keyboard.press('Escape');

  failPrepare = false; failMetadata = true;
  await page.getByRole('button', { name: '开始搜索', exact: true }).click();
  const search = page.getByRole('dialog', { name: '搜索音乐', exact: true });
  await search.getByLabel('弹窗搜索关键词', { exact: true }).fill('晴天'); await search.getByRole('button', { name: '搜索', exact: true }).click();
  await search.getByRole('button', { name: '播放 晴天 · 2026音乐会', exact: true }).click();
  await search.getByRole('button', { name: '播放失败，查看详情', exact: true }).click();
  assert.equal(await issueButton().count(), 1); await noBanner();
  failMetadata = false; await issuePanel().getByRole('button', { name: '重试播放', exact: true }).click();
  await issueButton().waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('.play-toggle')?.getAttribute('aria-busy') === 'false');
  await search.getByRole('button', { name: '关闭', exact: true }).click();

  await libraryAction(page, '新建歌单');
  const create = page.getByRole('dialog', { name: '新建歌单', exact: true });
  await create.getByLabel('歌单名称', { exact: true }).fill('保留失败的歌单草稿'); failWrite = true;
  await create.getByRole('button', { name: '保存歌单', exact: true }).click(); await create.getByRole('alert').waitFor();
  assert.equal(await page.locator('.desktop-operation-feedback').count(), 0);
  assert.equal(await create.getByLabel('歌单名称', { exact: true }).inputValue(), '保留失败的歌单草稿');
  failWrite = false; await create.getByRole('button', { name: '保存歌单', exact: true }).click(); await create.waitFor({ state: 'detached' });

  await page.getByRole('button', { name: '取消收藏 已失效现场', exact: true }).click(); await page.locator('.toast').waitFor();
  failWrite = true;
  await page.getByRole('button', { name: '取消收藏 保存失败的草稿', exact: true }).click();
  await page.locator('.desktop-operation-feedback').getByRole('alert').waitFor(); await noBanner();
  assert.equal(await page.locator('.toast').count(), 0, 'an earlier success toast cannot cover an operation error');
  assert.equal(await libraryTop(), beforeTop);
  await page.screenshot({ path: resolve(artifacts, 'operation-feedback.png') });
  failWrite = false; await page.getByRole('button', { name: '重试保留编辑', exact: true }).click();
  await page.locator('.desktop-operation-feedback').waitFor({ state: 'detached' });
  assert(!fixture.library.read().snapshot.favorites.some(favorite => favorite.songId === 'sun'));
  assert.deepEqual(errors, []);
});

test('desktop recommendation failures stay local, retain music and recover without a page banner', { timeout: 60000 }, async t => {
  const fixture = await startSongManagementFixture(); t.after(fixture.close);
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  const items = Array.from({ length: 12 }, (_, index) => ({ ...entry(ref(index + 100)), title: '夜间旋律 ' + (index + 1), uploader: { name: '音乐现场' } }));
  let issue, failRequest = false, empty = false, delay = 0, youtubeIssue, limit = 12;
  const shelf = (id, title, failure) => ({ id, title, kind: 'recommendation', page: { items: empty ? [] : items.slice(0, limit) }, recommendation: { token: id, batchId: id, fetchedAt: 1, pool: 12, entry: 1, processed: true, issue: failure, retained: !!failure } });
  await page.route('**/api/discovery/bilibili?*', async route => {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    return route.fulfill(failRequest ? { status: 503, json: { error: { code: 'network' } } } : { json: [shelf('music-recommendation', 'B站推荐', issue)] }).catch(() => {});
  });
  await page.route('**/api/status', route => route.fulfill({ json: { version: 'fixture', providers: { bilibili: { available: true }, youtube: { enabled: true, available: true } }, build: { stale: false } } }));
  await page.route('**/v1/handshake', route => route.fulfill({ json: { protocol: 2, capabilities: ['bilibili', 'youtube'].map(provider => ({ provider, operations: ['metadata', 'prepare', 'search'], anonymous: true, limitations: [] })) } }));
  await page.route('**/api/youtube/music?*', route => route.fulfill({ json: { region: 'HK', shelf: shelf('youtube-music-selection', 'YouTube 推荐', youtubeIssue), warnings: [], playlists: [], fetchedAt: 1 } }));
  const artifacts = resolve('local/verification/desktop-feedback'); await mkdir(artifacts, { recursive: true });
  await page.goto(fixture.origin);
  const bili = page.locator('[data-shelf-id="music-recommendation"]'), youtube = page.locator('[data-shelf-id="youtube-music-selection"]');
  await bili.locator('.music-card').last().waitFor();
  const contentTop = () => bili.locator('.cover-grid').evaluate(element => element.getBoundingClientRect().top);
  const beforeTop = await contentTop();
  const refresh = () => bili.getByRole('button', { name: 'B站推荐换一批', exact: true }).click();
  const status = () => bili.getByRole('button', { name: 'B站推荐：暂未更新，查看详情', exact: true });
  const panel = () => bili.locator('.discovery-status-popover [popover]:popover-open');
  const noBanner = async () => assert.equal(await page.locator('.main-content>.feedback,.main-content>.loading').count(), 0);

  issue = 'network'; await refresh(); await status().waitFor();
  await noBanner(); assert.equal(await bili.locator('.music-card').count(), 12); assert.equal(await contentTop(), beforeTop);
  assert.equal(await bili.getByText('暂时无法更新推荐，请稍后重试。', { exact: true }).isVisible(), false);
  await page.screenshot({ path: resolve(artifacts, 'recommendation-retained.png') });
  await status().click(); await panel().getByText('已保留当前可用的音乐。', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(artifacts, 'recommendation-details.png') });
  await page.keyboard.press('Escape'); assert.equal(await status().evaluate(element => element === document.activeElement), true);
  await status().click(); issue = undefined; await panel().getByRole('button', { name: '重试更新', exact: true }).click();
  await status().waitFor({ state: 'detached' }); assert.equal(await contentTop(), beforeTop);

  failRequest = true; await refresh(); await status().waitFor(); await noBanner(); assert.equal(await contentTop(), beforeTop);
  failRequest = false; delay = 1500; await refresh();
  await bili.getByRole('button', { name: 'B站推荐：正在更新，查看详情', exact: true }).click();
  await panel().getByRole('button', { name: '取消更新', exact: true }).click(); delay = 0;
  await page.waitForFunction(() => !document.querySelector('[data-shelf-id="music-recommendation"] .shelf-refresh').disabled);
  assert.equal(await bili.locator('.music-card').count(), 12); assert.equal(await contentTop(), beforeTop);

  youtubeIssue = 'network'; await youtube.getByRole('button', { name: 'YouTube 推荐换一批', exact: true }).click();
  await youtube.getByRole('button', { name: 'YouTube 推荐：暂未更新，查看详情', exact: true }).waitFor();
  assert.equal(await youtube.locator('.catalog-status [role="alert"]').count(), 0);
  await bili.getByRole('button', { name: '播放 夜间旋律 1', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .1);
  const audioSource = await page.locator('audio').evaluate(audio => audio.currentSrc);
  issue = 'network'; await refresh(); await status().waitFor();
  assert.equal(await page.locator('audio').evaluate(audio => audio.currentSrc), audioSource);
  assert.equal(await page.locator('audio').evaluate(audio => audio.paused), false);
  await page.emulateMedia({ colorScheme: 'dark' });
  await bili.getByRole('button', { name: 'B站推荐列表视图', exact: true }).click();
  await page.screenshot({ path: resolve(artifacts, 'recommendation-retained-dark-list.png'), animations: 'disabled' });
  await status().click(); await page.screenshot({ path: resolve(artifacts, 'recommendation-details-dark-list.png') }); await page.keyboard.press('Escape');
  limit = 3; issue = undefined; await refresh(); await status().waitFor({ state: 'detached' });
  await page.waitForFunction(() => !document.querySelector('[data-shelf-id="music-recommendation"] .shelf-refresh').disabled && document.querySelectorAll('[data-shelf-id="music-recommendation"] .track-row').length === 3);
  const shortTop = await bili.locator('.track-list').evaluate(element => element.getBoundingClientRect().top);
  failRequest = true; await refresh(); await status().waitFor();
  assert.equal(await bili.locator('.track-list').evaluate(element => element.getBoundingClientRect().top), shortTop, 'a short retained batch keeps its availability note and list position');
  failRequest = false; limit = 12; await refresh(); await status().waitFor({ state: 'detached' });
  issue = 'network'; await refresh(); await status().waitFor();
  for (const width of [1440, 960, 761]) {
    await page.setViewportSize({ width, height: 1000 }); await status().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByText(/网络或服务连接中断/).first().waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await bili.getByRole('button', { name: 'B站推荐封面视图', exact: true }).click();

  empty = true; issue = 'bilibili-authentication'; await page.reload();
  await bili.getByRole('heading', { name: '暂时无法获取推荐', exact: true }).waitFor(); await noBanner();
  await bili.getByText('B站登录已过期，可在设置中重新扫码登录。', { exact: true }).waitFor();
  assert.equal(await bili.locator('.catalog-empty-slot,.discovery-status').count(), 0);
  empty = false; issue = undefined; await bili.getByRole('button', { name: '重新获取推荐', exact: true }).click();
  await bili.locator('.music-card').last().waitFor(); assert.equal(await status().count(), 0);
  failRequest = true; await page.reload(); await bili.getByRole('heading', { name: '暂时无法获取推荐', exact: true }).waitFor();
  await noBanner(); await page.screenshot({ path: resolve(artifacts, 'recommendation-empty.png') });
  assert.deepEqual(errors, []);
});
