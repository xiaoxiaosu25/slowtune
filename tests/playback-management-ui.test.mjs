import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import { startSongManagementFixture } from './helpers/song-management-fixture.mjs';
import { navigate } from '../scripts/browser-ui.mjs';
import { queueRecord } from './helpers/song-fixture.mjs';
import { developmentPaths } from '../scripts/workspace-paths.mjs';

async function openVersions(page, surface = page) {
  assert.equal(await surface.locator('.playing-artist button').count(), 0, 'the artist line only shows the singer');
  await surface.getByRole('button', { name: '查看歌曲来源', exact: true }).click();
  const source = surface.getByLabel('歌曲来源详情', { exact: true });
  await source.getByRole('button', { name: '选择播放版本', exact: true }).click();
  await source.waitFor({ state: 'hidden' });
}
async function openLyricsSettings(page){await page.getByRole('button',{name:'更多播放选项',exact:true}).click();await page.getByRole('button',{name:'歌词管理',exact:true}).click();return page.getByRole('dialog',{name:'歌词设置',exact:true});}
async function openOffset(settings){const details=settings.locator('.lyrics-offset');if(await details.getAttribute('open')===null)await details.locator('summary').click();}

test('desktop versions, source facts, in-place audition and per-source lyric management', { timeout: 120000 }, async t => {
  const fixture = await startSongManagementFixture(); t.after(fixture.close);
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  const states = new Map(), document = { provider: 'local', id: 'original', title: '晴天原歌词', artists: ['周杰伦'], synced: true, lines: [{ startMs: 0, text: '原歌词第一句' }, { startMs: 4000, text: '原歌词第二句' }] };
  const stateFor = ref => { const id = ref.id + ':' + ref.part; if (!states.has(id)) states.set(id, { revision: 'r0', offsetMs: 0, document: structuredClone(document) }); return states.get(id); };
  await page.route('**/api/lyrics/state', route => route.fulfill({ json: stateFor(route.request().postDataJSON().ref) }));
  await page.route('**/api/lyrics/offset', route => { const input = route.request().postDataJSON(), state = stateFor(input.ref); state.offsetMs = input.offsetMs; state.revision += '1'; return route.fulfill({ json: state }); });
  const candidate = { provider: 'lrclib', id: 'alternate', title: '晴天其他歌词', artists: ['周杰伦'], synced: true, durationSeconds: 60 };
  await page.route('**/api/lyrics/search-progress', route => route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ candidates: [candidate], issues: [], complete: true }) + '\n' }));
  await page.route('**/api/lyrics/document', route => route.fulfill({ json: { ...document, ...candidate, lines: [{ startMs: 0, text: '候选歌词全文第一句' }, { startMs: 4000, text: '候选歌词全文第二句' }] } }));
  await page.route('**/api/lyrics/select', route => { const state = stateFor(route.request().postDataJSON().ref); state.document = { ...document, ...candidate, lines: [{ startMs: 0, text: '候选歌词全文第一句' }] }; state.offsetMs = 0; state.revision += '1'; return route.fulfill({ json: state }); });
  let fail = false;
  await page.route('**/v1/call/prepare', route => fail ? route.fulfill({ status: 503, json: { protocol: 2, error: { code: 'network' } } }) : route.continue());
  await page.goto(fixture.origin); await navigate(page, '歌单');
  await page.getByRole('button', { name: '播放 晴天', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .1);
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  assert.equal(await page.locator('.desktop-tools-floating').count(), 0);
  assert.equal(await page.locator('.playback-mode-label').count(), 0);
  assert.equal(await page.locator('.listening-transport').getByRole('button', { name: '收藏当前歌曲', exact: true }).count(), 1);
  assert.equal(await page.locator('.playing-song-actions').getByRole('button', { name: '收藏当前歌曲', exact: true }).count(), 0);
  await page.getByRole('button', { name: '查看歌曲来源', exact: true }).focus();
  await page.getByLabel('歌曲来源详情', { exact: true }).getByText('原唱 · 录音室 · 来源原始标题', { exact: true }).waitFor();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copiedSource = value; } } }));
  await page.getByRole('button', { name: '复制链接', exact: true }).click(); await page.getByRole('button', { name: '已复制', exact: true }).waitFor();
  assert.match(await page.evaluate(() => window.__copiedSource), /BV0000000001/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '播放速度', exact: true }).click(); await page.getByRole('menuitemradio', { name: '1.5×', exact: true }).click();
  const record = () => page.evaluate(() => JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
  const before = await record();
  await openVersions(page);
  const panel = page.getByRole('dialog', { name: '播放版本', exact: true }); await panel.waitFor();
  const live = panel.locator('.playback-version-card').filter({ hasText: '演唱会现场' });
  fail = true; const oldSource = await page.locator('audio').getAttribute('src');
  await live.getByRole('button', { name: '播放此版本', exact: true }).click();
  await panel.getByRole('alert').waitFor(); assert.equal(await page.locator('audio').getAttribute('src'), oldSource); assert.equal((await record()).current, before.current); assert.equal(await page.locator('audio').evaluate(audio => audio.paused), false);
  fail = false; await live.getByRole('button', { name: '播放此版本', exact: true }).click();
  // A new currentSrc appears before the version switch restores native controls.
  // Check the completed switch, including the actual rate and saved preference.
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio'), saved = JSON.parse(localStorage.getItem('slow-listening:playback:v3'));
    return audio?.currentSrc.includes('BV0000000002') && audio.playbackRate === 1.5 && saved?.rate === 1.5;
  });
  const after = await record(); assert.equal(after.current, before.current); assert.deepEqual(after.items.map(item => item.instanceId), before.items.map(item => item.instanceId)); assert.equal(after.rate, 1.5);
  assert.equal(fixture.library.read().snapshot.songs.find(song => song.id === 'sun').defaultVersionId, 'studio');
  const liveSource = await page.locator('audio').getAttribute('src');
  await live.getByRole('button', { name: '设为默认', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.playback-version-card')].some(card => card.textContent.includes('演唱会现场') && card.textContent.includes('默认版本')));
  assert.equal(fixture.library.read().snapshot.songs.find(song => song.id === 'sun').defaultVersionId, 'live'); assert.equal(await page.locator('audio').getAttribute('src'), liveSource);
  await panel.locator('.playback-version-card').filter({ hasText: '原唱 · 录音室' }).getByRole('button', { name: '设为默认', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.playback-version-card')].some(card => card.textContent.includes('原唱 · 录音室') && card.textContent.includes('默认版本')));
  await panel.getByRole('button', { name: '搜索其他版本', exact: true }).click();
  assert.equal(await panel.getByLabel('版本搜索关键词', { exact: true }).inputValue(), '晴天 周杰伦');
  await panel.getByRole('button', { name: '搜索', exact: true }).click();
  await panel.getByRole('button', { name: '试听', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentSrc.includes('BV0000000006'));
  assert.equal((await record()).current, before.current); assert.equal(fixture.library.read().snapshot.versions.some(version => version.ref.id === 'BV0000000006'), false);
  await panel.getByRole('button', { name: '保存版本', exact: true }).click();
  await panel.getByRole('button', { name: '已保存版本', exact: true }).waitFor();
  assert.equal(fixture.library.read().snapshot.songs.find(song => song.id === 'sun').defaultVersionId, 'studio');
  await panel.getByRole('button',{name:'完成',exact:true}).click();
  let settings=await openLyricsSettings(page);await openOffset(settings);
  await settings.getByRole('button',{name:'延后 0.5 秒',exact:true}).click();
  assert.equal(await settings.getByLabel('歌词延后秒数',{exact:true}).inputValue(),'0.5');
  await settings.getByRole('button',{name:'关闭',exact:true}).click();
  settings=await openLyricsSettings(page);await openOffset(settings);
  assert.equal(await settings.getByLabel('歌词延后秒数',{exact:true}).inputValue(),'0');
  await settings.getByRole('button',{name:'延后 0.5 秒',exact:true}).click();await settings.getByRole('button',{name:'保存偏移',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.lyric-offset-value')?.textContent.includes('已保存'));
  await settings.getByRole('button',{name:'更换或导入歌词',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'选择歌词',exact:true});await picker.getByText('候选歌词全文第二句',{exact:true}).waitFor();
  assert.equal(stateFor({id:'BV0000000006',part:'10'}).document.title,'晴天原歌词');
  await picker.getByRole('button',{name:'使用这份歌词',exact:true}).click();await picker.waitFor({state:'detached'});
  settings=await openLyricsSettings(page);await openOffset(settings);
  await settings.locator('.lyrics-source').filter({hasText:'晴天其他歌词'}).waitFor();
  await settings.getByRole('button',{name:'延后 0.5 秒',exact:true}).click();await settings.getByRole('button',{name:'保存偏移',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.lyric-offset-value')?.textContent.includes('已保存'));
  await settings.getByRole('button',{name:'关闭',exact:true}).click();await openVersions(page);
  await panel.locator('.playback-version-card').filter({ hasText: '原唱 · 录音室' }).getByRole('button', { name: '播放此版本', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentSrc.includes('BV0000000001'));
  await panel.getByRole('button',{name:'完成',exact:true}).click();settings=await openLyricsSettings(page);await openOffset(settings);
  assert.equal(await settings.getByLabel('歌词延后秒数',{exact:true}).inputValue(),'0');await settings.getByRole('button',{name:'关闭',exact:true}).click();
  const artifacts = join(developmentPaths().testRuntime, 'playback-management'); await mkdir(artifacts, { recursive: true });
  await openVersions(page);
  await panel.locator('.playback-version-card').filter({ hasText: '晴天 · 2026音乐会' }).getByRole('button', { name: '播放此版本', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentSrc.includes('BV0000000006'));
  await panel.getByRole('button',{name:'完成',exact:true}).click();settings=await openLyricsSettings(page);await openOffset(settings);
  await page.waitForFunction(() => document.querySelector('[aria-label="歌词延后秒数"]')?.value === '0.5');
  await settings.getByRole('button',{name:'关闭',exact:true}).click();await openVersions(page);
  await page.screenshot({ path: join(artifacts, 'lyrics-management.png'), animations: 'disabled' });
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1000, height: 640 }, { width: 761, height: 600 }]) {
    await page.setViewportSize(viewport);
    const box=await panel.boundingBox(),done=await panel.getByRole('button',{name:'完成',exact:true}).boundingBox();
    assert(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height&&done.y+done.height<=box.y+box.height,'the independent version dialog and footer fit the viewport');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(artifacts, `management-${viewport.width}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await panel.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '打开沉浸歌词', exact: true }).click();
  await openVersions(page, page.locator('.desktop-lyrics-view'));
  assert.equal(await panel.getByRole('tab').count(),0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '校准时间', exact: true }).click(); await page.locator('.lyric-offset-popover [popover]:popover-open').getByLabel('歌词延后秒数', { exact: true }).waitFor();
  await page.keyboard.press('Escape'); assert.equal(await page.locator('.lyric-offset-popover [popover]:popover-open').count(), 0); assert.equal(await panel.count(), 0); assert.equal(await page.locator('.desktop-lyrics-view').isVisible(), true);
  await page.getByRole('button', { name: '更换歌词', exact: true }).click(); await picker.getByRole('button', { name: '查找歌词', exact: true }).waitFor();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.screenshot({ path: join(artifacts, 'playing-desktop.png'), animations: 'disabled' });
  assert.deepEqual(errors, []);
});

test('unowned source auditions replace the current occurrence and never create library records', { timeout: 45000 }, async t => {
  const fixture = await startSongManagementFixture(); t.after(fixture.close);
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(8000);
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  const track = { ref: { provider: 'bilibili', kind: 'video', id: 'BV0000000006', part: '10' }, resourceId: 'unowned', title: '未归组的歌曲' };
  const other = { ...track, ref: { ...track.ref, id: 'BV0000000007' }, title: '其他现场来源' };
  await page.addInitScript(record => localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record)), queueRecord([track]));
  await page.route('**/api/search', route => route.fulfill({ json: { items: [other] } }));
  await page.route('**/api/lyrics/state', route => route.fulfill({ json: { revision: 'plain', offsetMs: 0, document: { provider: 'local', id: 'plain', title: '纯文本歌词', artists: [], synced: false, lines: [{ startMs: null, text: '只有正文，没有时间轴' }] } } }));
  await page.goto(fixture.origin); await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await page.locator('.listening-transport .play-toggle').click(); await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .1);
  const before = fixture.library.read();
  await openVersions(page); const panel = page.getByRole('dialog', { name: '播放版本', exact: true });
  await panel.getByRole('button', { name: '搜索其他版本', exact: true }).click(); await panel.getByRole('button', { name: '搜索', exact: true }).click(); await panel.getByRole('button', { name: '试听', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentSrc.includes('BV0000000007'));
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
  assert.equal(after.current, 'unowned'); assert.equal(after.items.length, 1); assert.equal(after.items[0].selection.ref.id, other.ref.id); assert.deepEqual(fixture.library.read(), before);
  await panel.getByRole('button', { name: '保存版本', exact: true }).click();
  await page.getByRole('dialog', { name: '归入歌曲', exact: true }).waitFor(); assert.deepEqual(fixture.library.read(), before);
});

for (const action of ['select', 'import']) test(`closing lyric management during ${action} keeps it closed after saving`, { timeout: 30000 }, async t => {
  const fixture = await startSongManagementFixture(); t.after(fixture.close);
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(8000);
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  const original = { provider: 'local', id: 'original', title: '原歌词', artists: [], synced: true, lines: [{ startMs: 0, text: '原歌词第一句' }] };
  const replacement = { ...original, provider: action === 'select' ? 'lrclib' : 'local', id: 'replacement', title: '保存后的歌词', lines: [{ startMs: 0, text: '保存后的歌词' }] };
  let state = { revision: 'r0', offsetMs: 0, document: original };
  await page.route('**/api/lyrics/state', route => route.fulfill({ json: state }));
  await page.route('**/api/lyrics/search-progress', route => route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ candidates: [replacement], issues: [], complete: true }) + '\n' }));
  await page.route('**/api/lyrics/document', route => route.fulfill({ json: replacement }));
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), submitted = new Promise(resolve => { started = resolve; });
  t.after(() => release());
  await page.route('**/api/lyrics/' + action, async route => {
    started(); await gate;
    state = { ...state, revision: 'r1', document: replacement };
    await route.fulfill({ json: state }).catch(() => {});
  });
  await page.goto(fixture.origin); await navigate(page, '歌单');
  await page.getByRole('button', { name: '播放 晴天', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .1);
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  const source = await page.locator('audio').getAttribute('src');
  await page.getByRole('button', { name: '更多播放选项', exact: true }).click();
  await page.getByRole('button', { name: '歌词管理', exact: true }).click();
  const settings=page.getByRole('dialog',{name:'歌词设置',exact:true});
  await settings.getByRole('button', { name: '更换或导入歌词', exact: true }).click();
  const panel=page.getByRole('dialog',{name:'选择歌词',exact:true});
  if (action === 'select') {
    await panel.getByRole('button', { name: '使用这份歌词', exact: true }).click();
  } else {
    await panel.getByText('导入歌词', { exact: true }).click();
    await panel.getByLabel('粘贴歌词正文', { exact: true }).fill('[00:00]保存后的歌词');
    await panel.getByRole('button', { name: '使用导入歌词', exact: true }).click();
  }
  await submitted;
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  release();
  await page.getByRole('region', { name: '底部歌词', exact: true }).getByText('保存后的歌词', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0, 'a completed save never reopens the standalone lyric dialog');
  assert.equal(await page.locator('audio').getAttribute('src'), source);
  assert.equal(await page.locator('audio').evaluate(audio => audio.paused), false);
  await page.getByRole('button', { name: '更多播放选项', exact: true }).click();
  await page.getByRole('button', { name: '歌词管理', exact: true }).click();
  await settings.locator('.lyrics-source').filter({ hasText: '保存后的歌词' }).waitFor();
});
