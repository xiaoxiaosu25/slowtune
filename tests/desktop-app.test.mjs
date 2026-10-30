import { test } from 'node:test';
import { desktopBuildDirectory, developmentPaths } from '../scripts/workspace-paths.mjs';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import electron from 'electron';
import { _electron } from 'playwright-core';
import { createPlayingArtworkFixture } from './helpers/playing-artwork-fixture.mjs';
import { alive, closeDesktop } from './helpers/desktop-process.mjs';
import { captureDesktopWindow } from './helpers/desktop-capture.mjs';
import { markOwnedFixture } from './helpers/desktop-owned-fixture.mjs';
import { queueRecord } from './helpers/song-fixture.mjs';
import { lyricWindowState } from './helpers/windows-window-state.mjs';

const root = resolve('.'), output = join(developmentPaths().testRuntime, 'desktop-tests'); mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function windowAt(application, predicate) { for (let n = 0; n < 250; n++) { const page = application.windows().find(page => predicate(page.url())); if (page) return page; await sleep(60); } const pages = application.windows(); throw new Error('Window timeout: ' + JSON.stringify(await Promise.all(pages.map(async page => ({ url: page.url(), text: (await page.locator('body').innerText()).slice(0, 1200) }))))); }

test('desktop setup keeps native controls without adding a title or menu row', { timeout: 30000 }, async t => {
  const directory = mkdtempSync(join(output, 'setup-chrome-'));
  const env = { ...process.env, MUSIC_APP_CONFIG: '', MUSIC_APP_DESKTOP_DATA: directory, MUSIC_APP_DESKTOP_ROOT: resolve(process.env.MUSIC_APP_TEST_BUILD ?? desktopBuildDirectory()) };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const application = await _electron.launch({ executablePath: electron, args: [join(root, 'desktop'), '--force-device-scale-factor=1'], env, timeout: 20000 });
  t.after(() => closeDesktop(application));
  const page = await windowAt(application, url => url.endsWith('/setup.html'));
  await page.waitForFunction(() => ['light','dark'].includes(document.documentElement.dataset.theme) && navigator.windowControlsOverlay.visible);
  assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el, '::before').getPropertyValue('app-region')), 'drag');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), false);
  await captureDesktopWindow(application, page, join(directory, 'setup-native.png'));
});

test('Windows integrated chrome, immersive and floating lyrics retain one player and close the backend', { timeout: 180000 }, async t => {
  const directory = mkdtempSync(join(output, 'app-')), product = join(directory, 'service'), data = join(directory, 'profile');
  mkdirSync(join(product, 'dist/server'), { recursive: true }); mkdirSync(join(product, 'scripts')); mkdirSync(join(product, 'dist/client'));
  mkdirSync(data); writeFileSync(join(data, 'desktop-state.json'), JSON.stringify({ lyrics: { visible: false } }));
  cpSync(join(resolve(process.env.MUSIC_APP_TEST_BUILD ?? desktopBuildDirectory()), 'dist/server/config.js'), join(product, 'dist/server/config.js'));
  writeFileSync(join(product, 'package.json'), '{"type":"module"}'); writeFileSync(join(product, 'dist/client/index.html'), 'assets/index-fixture.js');
  const first = { provider: 'local', id: 'floating', title: '受控歌词', artists: [], synced: true, lines: [{ startMs: 1000, text: '让晚风慢慢经过身旁', translation: 'Let the evening breeze pass gently by' }, { startMs: 5000, text: '听风', words: [{ text: '听', startMs: 5000, endMs: 7000 }, { text: '风', startMs: 7000, endMs: 9000 }] }, { startMs: 12000, text: '听见远方' }] };
  let backend, stops = 0;
  const stateFile = join(data, 'runtime/service.json');
  const fixture = await createPlayingArtworkFixture({ preview: true, handleRequest: async ({ request, response, url, json }) => {
    if (url.pathname.startsWith('/internal/') && request.headers['x-control-key'] !== 'isolated-fixture-key') { json({}, 403); return true; }
    if (url.pathname === '/internal/diagnose') { json({ sources: { disposed: false }, delivery: { disposed: false }, build: { stale: false } }); return true; }
    if (url.pathname === '/internal/desktop-session') { response.setHeader('Set-Cookie', 'music_session=' + 'a'.repeat(43) + '; Path=/; HttpOnly'); json({}); return true; }
    if (url.pathname === '/internal/stop') { stops++; if (existsSync(stateFile)) unlinkSync(stateFile); backend.send('stop'); json({}); return true; }
    if (url.pathname === '/api/lyrics/state') { const chunks = []; for await (const chunk of request) chunks.push(chunk); const ref = JSON.parse(Buffer.concat(chunks).toString()).ref; json({ revision: 'floating', offsetMs: 1000, document: ref.part === '900' ? first : { ...first, id: 'second', lines: [{ startMs: 0, text: '下一首歌词' }] } }); return true; }
    return false;
  } });
  const config = { host: '127.0.0.1', port: Number(new URL(fixture.base).port), allowedHosts: ['127.0.0.1', 'localhost'], accessKey: 'isolated-desktop-test', userSpace: 'fixture', database: join(data, 'library.sqlite'), runtimeDirectory: join(data, 'runtime') };
  mkdirSync(join(data, 'instance')); const file = join(data, 'instance/config.local.json'); writeFileSync(file, JSON.stringify(config));
  writeFileSync(join(data, 'preferences.json'), JSON.stringify({ 'slow-listening:playback:v3': JSON.stringify(queueRecord(fixture.tracks, { volume: .3 })) }));
  const env = { ...process.env, MUSIC_APP_CONFIG: file, MUSIC_APP_NODE: process.execPath, MUSIC_APP_DESKTOP_ROOT: product, MUSIC_APP_DESKTOP_DATA: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  let application;
  const launch = async () => {
    backend = spawn(process.execPath, ['-e', "process.on('message',()=>process.exit(0));setInterval(()=>{},1000)"], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    await new Promise((done, reject) => { backend.once('spawn', done); backend.once('error', reject); });
    markOwnedFixture(product, file, config, backend.pid, 'isolated-fixture-key');
    writeFileSync(join(product, 'scripts/launch.mjs'), `import{readFileSync,mkdirSync,writeFileSync}from'node:fs';import{join}from'node:path';const c=JSON.parse(readFileSync(process.env.MUSIC_APP_CONFIG,'utf8'));mkdirSync(c.runtimeDirectory,{recursive:true});writeFileSync(join(c.runtimeDirectory,'service.json'),JSON.stringify({pid:${backend.pid},port:c.port,key:'isolated-fixture-key'}));console.log(JSON.stringify({action:'started',pid:${backend.pid}}));`);
    // Geometry assertions compare native bounds and CSS pixels at a fixed scale.
    return _electron.launch({ executablePath: electron, args: [join(root, 'desktop'), '--force-device-scale-factor=1'], env, timeout: 25000 });
  };
  application = await launch(); t.after(async () => {
    try { if (application) await closeDesktop(application); }
    finally { await fixture.close(); if (backend && alive(backend.pid)) backend.kill(); }
  });
  const page = await windowAt(application, url => url === fixture.base + '/'); page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://i1.hdslb.com/**', route => route.fulfill({ contentType: 'image/png', body: readFileSync(join(root, 'public/assets/coast.png')) }));
  await page.locator('.desktop-tools').waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.desktopMode === 'standard' && navigator.windowControlsOverlay.visible);
  assert.equal(await page.locator('.topbar').evaluate(el => el.getBoundingClientRect().top), 0);
  assert.equal(await page.locator('.topbar').evaluate(el => getComputedStyle(el).getPropertyValue('app-region')), 'drag');
  assert.equal(await page.locator('.search-field').evaluate(el => getComputedStyle(el).getPropertyValue('app-region')), 'no-drag');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http:')).isMenuBarVisible()), false);
  assert.equal(await application.evaluate(({ Menu }) => Menu.getApplicationMenu()), null);
  assert.equal(await page.getByRole('button', { name: '应用菜单', exact: true }).count(), 0);
  assert.equal(await page.locator('.topbar-actions').count(), 0);
  assert.equal(await page.locator('.desktop-tools button').count(), 3);
  const geometry = () => page.evaluate(() => Object.fromEntries(['.sidebar','.main-content','.page-heading','.playbar','.playbar-inner'].map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return [selector, [r.x,r.y,r.width,r.height]]; })));
  await page.evaluate(() => document.fonts.ready);
  const nativeGeometry = await geometry();
  await page.evaluate(() => delete document.documentElement.dataset.desktopHost);
  assert.deepEqual(await geometry(), nativeGeometry, 'native chrome does not rearrange content');
  await page.evaluate(() => { document.documentElement.dataset.desktopHost = 'true'; });
  for (const theme of ['light', 'dark']) {
    const label = theme === 'light' ? '切换为浅色' : '切换为深色';
    if (await page.getByRole('button', { name: label, exact: true }).count()) await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
    assert.equal(await application.evaluate(({ nativeTheme }) => nativeTheme.themeSource), theme);
    const caption = await page.evaluate(() => { const r = navigator.windowControlsOverlay.getTitlebarAreaRect(); return { width: r.width, height: r.height }; });
    const tools = await page.locator('.desktop-tools').boundingBox(), sidebar = await page.locator('.sidebar').boundingBox(), dock = await page.locator('.playbar').boundingBox();
    assert.equal(caption.height, 40); assert.equal(await page.locator('.topbar').evaluate(el => getComputedStyle(el).borderBottomWidth), '0px');
    assert(tools.x >= sidebar.x && tools.x + tools.width <= sidebar.x + sidebar.width && tools.y + tools.height <= dock.y, 'utilities fit the bottom of the sidebar above the player');
    await captureDesktopWindow(application, page, join(directory, 'integrated-' + theme + '.png'));
  }
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http:')).maximize());
  const maximizedWidth = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http:')).getContentSize()[0]);
  await page.waitForFunction(value => innerWidth === value, maximizedWidth);
  await captureDesktopWindow(application, page, join(directory, 'integrated-maximized.png'));
  await application.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http:'));
    // Native restore applies its saved bounds asynchronously on Windows.
    if (w.isMaximized()) await new Promise(done => { w.once('unmaximize', done); w.unmaximize(); });
    w.setSize(1000, 640);
  });
  await page.waitForFunction(() => innerWidth <= 1000);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await captureDesktopWindow(application, page, join(directory, 'integrated-minimum.png'));
  await application.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http:')); w.setSize(1360,860); w.setFullScreen(true); });
  await page.waitForFunction(() => document.documentElement.dataset.desktopFullscreen === 'true');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http:')).setFullScreen(false));
  await page.waitForFunction(() => document.documentElement.dataset.desktopFullscreen === 'false');
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click(); await page.locator('.listening-transport .play-toggle').click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .2);
  await page.locator('.listening-transport .play-toggle').click();
  await page.locator('audio').evaluate(audio => { audio.currentTime = 7; audio.dispatchEvent(new Event('timeupdate')); });
  const preparations = fixture.preparations.length, source = await page.locator('audio').getAttribute('src');
  assert.equal(await page.locator('.bottom-lyrics,.has-bottom-lyrics').count(), 0);
  await page.getByRole('button', { name: '打开沉浸歌词', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.desktopMode === 'immersive' && navigator.windowControlsOverlay.getTitlebarAreaRect().height === 40);
  await page.locator('.desktop-lyrics-host').waitFor();
  assert.equal(await page.getByRole('button', { name: '应用菜单', exact: true }).count(), 0);
  assert.equal(await page.locator('.desktop-tools').isVisible(), false);
  await captureDesktopWindow(application, page, join(directory, 'integrated-immersive.png'));
  assert.equal(await page.locator('audio').getAttribute('src'), source); assert.equal(fixture.preparations.length, preparations);
  await page.getByRole('button', { name: '关闭沉浸歌词', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.desktopMode === 'standard');
  await page.getByRole('button', { name: '更多播放选项', exact: true }).click();
  assert.equal(await page.getByLabel('桌面悬浮歌词', { exact: true }).isChecked(), true, 'floating lyrics enable without an extra action');
  assert.equal(await page.getByLabel('底部歌词', { exact: true }).count(), 0);
  const overlay = await windowAt(application, url => url.endsWith('/lyrics.html')); overlay.setDefaultTimeout(12000);
  const assertOverlayTopmost = async stage => {
    const detail = await lyricWindowState(application);
    t.diagnostic(JSON.stringify({ stage, ...detail }));
    assert.equal(detail.native.valid, true, stage + ': the native HWND exists');
    assert.equal(detail.native.pid, detail.electron.pid, stage + ': probe reads the Electron process');
    assert.equal(detail.electron.topmost, true, stage + ': Electron reports topmost');
    assert.equal(detail.native.topmost, true, stage + ': Win32 WS_EX_TOPMOST is set');
  };
  await overlay.waitForFunction(() => document.querySelector('#current')?.dataset.line === '1');
  await assertOverlayTopmost('created and shown');
  const originalSource = await overlay.evaluate(() => window.slowTuneLyrics.getState().then(state => state.document.sourceKey));
  assert.equal((await overlay.locator('#current .word > span:first-child').allTextContents()).join(''), '听风');
  assert.equal(await page.locator('audio').count(), 1); assert.equal(fixture.preparations.length, preparations); assert.equal(await page.locator('audio').getAttribute('src'), source);
  await overlay.waitForFunction(() => { const fill = document.querySelector('.word'); return fill && Number(fill.style.getPropertyValue('--fill')) > .4 && Number(fill.style.getPropertyValue('--fill')) < .6; });
  const paused = await overlay.locator('#current').getAttribute('data-time'); await sleep(200); assert.equal(await overlay.locator('#current').getAttribute('data-time'), paused);
  await overlay.locator('body').screenshot({ path: join(directory, 'floating-lyrics.png'), omitBackground: true });
  await page.locator('audio').evaluate(audio => { audio.currentTime = 3; audio.dispatchEvent(new Event('timeupdate')); });
  await overlay.getByText('让晚风慢慢经过身旁', { exact: true }).waitFor();
  assert.equal(await overlay.locator('#secondary').textContent(), 'Let the evening breeze pass gently by');
  await overlay.locator('body').screenshot({ path: join(directory, 'floating-translation.png'), omitBackground: true });
  await page.locator('audio').evaluate(audio => { audio.playbackRate = 2; audio.currentTime = 7; audio.dispatchEvent(new Event('timeupdate')); });
  await overlay.waitForFunction(() => document.querySelector('#current')?.dataset.line === '1');
  const lyricSnapshot = await page.evaluate(() => window.slowTuneDesktop.getState());
  const waitForOverlayVisibility = async expected => {
    for (let n = 0; n < 100; n++) {
      const visible = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === '慢听 · 桌面歌词').isVisible());
      if (visible === expected) return;
      await sleep(30);
    }
    assert.fail('Floating lyric window visibility did not become ' + expected);
  };
  const publishLyricDocument = value => page.evaluate(value => window.slowTuneDesktop.publishDocument(value), value);
  for (const value of [
    { ...lyricSnapshot.document, lines: [], synced: false, status: '正在寻找歌词…' },
    { ...lyricSnapshot.document, lines: [], status: '暂无匹配歌词' },
    { ...lyricSnapshot.document, lines: [], status: '歌词暂不可用' },
    { ...lyricSnapshot.document, lines: [{ startMs: 0, text: '  \t ' }] },
    { ...lyricSnapshot.document, instrumental: true },
  ]) {
    await publishLyricDocument(value); await waitForOverlayVisibility(false);
    await overlay.waitForFunction(() => document.body.dataset.hasLyrics === 'false' && document.querySelector('#current').textContent === '' && document.querySelector('#secondary').textContent === '');
    assert.equal(await page.evaluate(() => window.slowTuneDesktop.getState().then(state => state.preferences.visible)), true, 'automatic hiding preserves the enabled preference');
  }
  await publishLyricDocument({ ...lyricSnapshot.document, synced: false, lines: [{ startMs: null, text: '没有时间轴的歌词' }, { startMs: null, text: '仍然有真实文字' }] });
  await waitForOverlayVisibility(true);
  await overlay.getByText('没有时间轴的歌词', { exact: true }).waitFor();
  assert.equal(await overlay.locator('#secondary').textContent(), '仍然有真实文字');
  await publishLyricDocument(lyricSnapshot.document); await waitForOverlayVisibility(true);
  await assertOverlayTopmost('hidden and shown again');
  // Match the real paused player: its periodic host snapshot remains authoritative.
  await page.locator('audio').evaluate(audio => { audio.currentTime = 0; audio.dispatchEvent(new Event('timeupdate')); });
  await page.evaluate(sourceKey => window.slowTuneDesktop.publishClock({ sourceKey, position: 0, playing: false }), originalSource);
  await overlay.getByText('让晚风慢慢经过身旁', { exact: true }).waitFor();
  await waitForOverlayVisibility(true);
  await page.evaluate(() => window.slowTuneDesktop.setLyricsVisible(false));
  await publishLyricDocument({ ...lyricSnapshot.document, lines: [] });
  await publishLyricDocument(lyricSnapshot.document); await waitForOverlayVisibility(false);
  assert.equal(await page.evaluate(() => window.slowTuneDesktop.getState().then(state => state.preferences.visible)), false, 'new lyrics do not override a manual close');
  await page.locator('audio').evaluate((audio, position) => { audio.currentTime = position; audio.dispatchEvent(new Event('timeupdate')); }, lyricSnapshot.clock.position);
  await page.evaluate(clock => { window.slowTuneDesktop.publishClock(clock); return window.slowTuneDesktop.setLyricsVisible(true); }, lyricSnapshot.clock);
  await waitForOverlayVisibility(true);
  await overlay.waitForFunction(() => document.querySelector('#current')?.dataset.line === '1');
  const overlayBounds = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '慢听 · 桌面歌词').getBounds());
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '慢听 · 桌面歌词').setPosition(120, 140));
  const beforeOptions = await overlayBounds();
  for (const close of ['button', 'escape']) {
    await overlay.getByRole('button', { name: '歌词显示选项', exact: true }).click();
    await overlay.getByRole('heading', { name: '快捷设置', exact: true }).waitFor();
    if (close === 'button') await overlay.getByRole('button', { name: '歌词显示选项', exact: true }).click();
    else await overlay.keyboard.press('Escape');
    await overlay.waitForFunction(() => !document.querySelector('#display-options').matches(':popover-open') && document.querySelector('#options').getAttribute('aria-expanded') === 'false');
    await overlay.waitForFunction(height => innerHeight === height, beforeOptions.height);
    assert.deepEqual(await overlayBounds(), beforeOptions, close + ' restores the compact position near the screen top');
  }
  await overlay.getByRole('button', { name: '歌词显示选项', exact: true }).click();
  await overlay.getByRole('heading', { name: '快捷设置', exact: true }).waitFor();
  const expanded = await overlayBounds();
  await application.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '慢听 · 桌面歌词').setPosition(bounds.x + 24, bounds.y + 24), expanded);
  await overlay.getByRole('slider', { name: '桌面歌词字号', exact: true }).fill('64');
  await overlay.waitForFunction(() => window.slowTuneLyrics.getState().then(state => state.preferences.fontSize === 64));
  await overlay.keyboard.press('Escape');
  await overlay.waitForFunction(() => !document.querySelector('#display-options').matches(':popover-open') && innerHeight < 320);
  const moved = await overlayBounds();
  assert.equal(moved.x, beforeOptions.x + 24);
  assert.equal(moved.y + moved.height, beforeOptions.y + beforeOptions.height + 24, 'dragging and changing font size preserve the compact bottom anchor');
  await overlay.evaluate(() => window.slowTuneLyrics.updatePreferences({ fontSize: 32 }));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '慢听 · 桌面歌词').setPosition(120, 140));
  await overlay.getByRole('button', { name: '歌词显示选项', exact: true }).click();
  await overlay.getByRole('heading', { name: '快捷设置', exact: true }).waitFor();
  assert.equal(await overlay.locator('#toolbar button svg').count(), 7);
  const compactBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '慢听 · 桌面歌词').getBounds());
  const panelBounds = await overlay.locator('#display-options').boundingBox(), toolbarBounds = await overlay.locator('#toolbar').boundingBox();
  assert(panelBounds.y >= 8 && panelBounds.y + panelBounds.height <= toolbarBounds.y, 'quick settings fit above the toolbar without clipping lyrics');
  await overlay.getByRole('slider', { name: '桌面歌词字号', exact: true }).fill('30');
  await overlay.getByRole('button', { name: '晴蓝', exact: true }).click();
  await overlay.waitForFunction(() => window.slowTuneLyrics.getState().then(state => state.preferences.fontSize === 30 && state.preferences.highlight === '#a7d8ff'));
  await overlay.locator('#lyric-color').fill('#ddeeff');
  await overlay.waitForFunction(() => window.slowTuneLyrics.getState().then(state => state.preferences.color === '#ddeeff'));
  await overlay.getByRole('button', { name: '减小字号', exact: true }).click();
  await overlay.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--lyric-size') === '28px');
  const doubleLane=await overlay.locator('#current').boundingBox();
  const doubleWindow=await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='慢听 · 桌面歌词').getBounds());
  await overlay.getByRole('checkbox', { name: '双行歌词', exact: true }).uncheck();
  await overlay.waitForFunction(() => document.body.dataset.lines === '1');
  assert.deepEqual(await overlay.locator('#current').boundingBox(),doubleLane,'single-line mode keeps the singing line in place');
  assert.deepEqual(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='慢听 · 桌面歌词').getBounds()),doubleWindow,'line count does not move or resize the native window');
  await overlay.getByRole('checkbox', { name: '双行歌词', exact: true }).check();
  await overlay.waitForFunction(() => document.body.dataset.lines === '2');
  assert.equal((await overlay.locator('#current .word > span:first-child').allTextContents()).join(''), '听风', 'display toggles retain the current lyric');
  await overlay.locator('body').screenshot({ path: join(directory, 'floating-display-options.png'), omitBackground: true });
  await overlay.getByRole('checkbox', { name: '显示翻译', exact: true }).uncheck();
  await overlay.getByRole('button', { name: '歌词设置…', exact: true }).click();
  await overlay.waitForFunction(height => innerHeight < height, compactBounds.height);
  const settings = page.locator('[data-settings-section="desktop-lyrics"]');
  await settings.waitFor({ state: 'visible' });
  assert.equal(await settings.getByRole('checkbox', { name: '显示歌词翻译', exact: true }).isChecked(), false);
  await settings.getByRole('checkbox', { name: '显示歌词翻译', exact: true }).check();
  await settings.getByRole('spinbutton', { name: '桌面歌词字号', exact: true }).fill('34');
  await settings.getByRole('spinbutton', { name: '桌面歌词字号', exact: true }).press('Enter');
  await settings.getByRole('button', { name: '薄荷', exact: true }).click();
  await overlay.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--lyric-size') === '34px' && getComputedStyle(document.documentElement).getPropertyValue('--lyric-highlight') === '#a6e9c5');
  await settings.getByRole('button', { name: '重置歌词位置', exact: true }).click();
  await settings.getByText('歌词位置已重置。', { exact: true }).waitFor();
  await captureDesktopWindow(application, page, join(directory, 'desktop-lyrics-settings.png'));
  assert.equal(await page.locator('audio').getAttribute('src'), source); assert.equal(fixture.preparations.length, preparations);
  await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(window => window.getTitle() === '慢听 · 桌面歌词'); window.setPosition(120, 140); });
  await application.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.getTitle() === '慢听 · 桌面歌词');
    const original = window.setIgnoreMouseEvents.bind(window);
    window.setIgnoreMouseEvents = (ignore, options) => { globalThis.lyricsIgnoreMouse = ignore; return original(ignore, options); };
    // CDP mouse input has a virtual pointer. Supply its corresponding desktop
    // coordinates without moving the user's physical cursor during the test.
    globalThis.originalLyricsCursor = screen.getCursorScreenPoint;
    globalThis.lyricsCursor = screen.getCursorScreenPoint();
    screen.getCursorScreenPoint = () => globalThis.lyricsCursor;
  });
  const ignoresMouse = () => application.evaluate(() => globalThis.lyricsIgnoreMouse);
  const waitForMouseState = async (expected, message) => {
    for (let n = 0; n < 100; n++) { if (await ignoresMouse() === expected) return; await sleep(20); }
    assert.equal(await ignoresMouse(), expected, message);
  };
  const nativePointer = (x, y) => application.evaluate(({ BrowserWindow }, point) => {
    const bounds = BrowserWindow.getAllWindows().find(window => window.getTitle() === '慢听 · 桌面歌词').getContentBounds();
    globalThis.lyricsCursor = { x: bounds.x + point.x, y: bounds.y + point.y };
  }, { x, y });
  const movePointer = async (x, y) => { await nativePointer(x, y); await overlay.mouse.move(x, y); };
  const hoverUnlock = async () => { const bounds = await overlay.locator('#unlock').boundingBox(); await movePointer(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); };
  const lyricPosition = () => overlay.locator('#current').evaluate(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y }; });
  const unlockedPosition = await lyricPosition();
  await overlay.getByRole('button', { name: '锁定', exact: true }).click();
  await page.waitForFunction(() => window.slowTuneDesktop.getState().then(state => state.preferences.locked));
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === '慢听 · 桌面歌词').isFocusable()), false);
  await assertOverlayTopmost('locked');
  assert.deepEqual(await lyricPosition(), unlockedPosition, 'locking does not move the lyric');
  await overlay.getByText('已锁定 · 悬停或从托盘解锁', { exact: true }).waitFor();
  assert.equal(await overlay.locator('#unlock').isVisible(), false);
  assert.equal(await ignoresMouse(), true, 'locked idle window ignores mouse input');
  const lyricArea = await overlay.locator('#lyrics').boundingBox(), controlsArea = await overlay.locator('#controls').boundingBox();
  const hoverLyric = () => movePointer(lyricArea.x + lyricArea.width / 2, lyricArea.y + lyricArea.height / 2);
  await hoverLyric(); await sleep(150);
  assert.equal(await overlay.locator('#unlock').isVisible(), false, 'quick pointer movement does not reveal the button');
  await movePointer(controlsArea.x + controlsArea.width - 18, controlsArea.y + 21);
  await sleep(700);
  assert.equal(await overlay.locator('#unlock').isVisible(), false, 'the hidden button position does not activate a hotspot');
  assert.equal(await ignoresMouse(), true);
  await overlay.waitForFunction(() => document.querySelector('#lock-notice').textContent === '');
  await hoverLyric(); await overlay.getByRole('button', { name: '解锁歌词', exact: true }).waitFor();
  assert.equal(await ignoresMouse(), true, 'revealing the button keeps the lyric area click-through');
  await hoverUnlock();
  await waitForMouseState(false, 'only pointing at the revealed button enables mouse input');
  await hoverLyric(); await waitForMouseState(true, 'leaving the button restores click-through');
  await overlay.locator('body').screenshot({ path: join(directory, 'floating-locked-hover.png'), omitBackground: true });
  await movePointer(1, 1);
  await overlay.waitForFunction(() => getComputedStyle(document.querySelector('#unlock')).visibility === 'hidden');
  assert.equal(await ignoresMouse(), true, 'faded controls leave no invisible mouse blocker');
  await overlay.locator('body').screenshot({ path: join(directory, 'floating-locked-idle.png'), omitBackground: true });
  await hoverLyric(); await overlay.getByRole('button', { name: '解锁歌词', exact: true }).waitFor();
  await hoverUnlock();
  await nativePointer(-10, -10);
  await overlay.waitForFunction(() => getComputedStyle(document.querySelector('#unlock')).visibility === 'hidden');
  assert.equal(await ignoresMouse(), true, 'native pointer exit clears controls even without a DOM movement');
  await hoverLyric(); await overlay.getByRole('button', { name: '解锁歌词', exact: true }).waitFor(); await hoverUnlock();
  // A renderer reload while pointing at the button must release the native hit target.
  await overlay.reload();
  await overlay.waitForFunction(() => document.body.dataset.locked === 'true');
  assert.equal(await ignoresMouse(), true);
  assert.equal(await overlay.locator('#unlock').isVisible(), false);
  assert.equal(await overlay.locator('#lock-notice').textContent(), '', 'restoring a locked window does not replay the teaching notice');
  await movePointer(1, 1); await hoverLyric();
  await overlay.getByRole('button', { name: '解锁歌词', exact: true }).waitFor();
  await hoverUnlock();
  await overlay.getByRole('button', { name: '解锁歌词', exact: true }).click();
  await page.waitForFunction(() => window.slowTuneDesktop.getState().then(state => !state.preferences.locked));
  assert.deepEqual(await lyricPosition(), unlockedPosition, 'unlocking does not move the lyric');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === '慢听 · 桌面歌词').isFocusable()), true);
  await assertOverlayTopmost('unlocked');
  await overlay.getByRole('button', { name: '锁定', exact: true }).click();
  await page.waitForFunction(() => window.slowTuneDesktop.getState().then(state => state.preferences.locked));
  await settings.getByRole('checkbox', { name: '锁定歌词（鼠标穿透）', exact: true }).uncheck();
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === '慢听 · 桌面歌词').isFocusable()), true);
  await application.evaluate(({ Tray }) => { const original = Tray.prototype.setContextMenu; globalThis.originalTrayMenu = original; Tray.prototype.setContextMenu = function(menu) { globalThis.reviewTrayMenu = menu; return original.call(this, menu); }; });
  await settings.getByRole('checkbox', { name: '锁定歌词（鼠标穿透）', exact: true }).check();
  await page.waitForFunction(() => window.slowTuneDesktop.getState().then(state => state.preferences.locked));
  assert.deepEqual(await application.evaluate(() => globalThis.reviewTrayMenu.items.filter(item => item.type !== 'separator').map(item => item.label)), ['打开慢听', '桌面歌词', '解锁歌词（恢复鼠标操作）', '重置歌词位置', '退出慢听']);
  await application.evaluate(() => globalThis.reviewTrayMenu.items.find(item => item.label.startsWith('解锁歌词')).click());
  await page.waitForFunction(() => window.slowTuneDesktop.getState().then(state => !state.preferences.locked));
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-settings-section="desktop-lyrics"] label')].find(label => label.textContent.includes('锁定歌词')).querySelector('input').checked);
  assert.equal(await settings.getByRole('checkbox', { name: '锁定歌词（鼠标穿透）', exact: true }).isChecked(), false, 'tray recovery also updates the settings panel');
  await application.evaluate(({ screen }) => { screen.getCursorScreenPoint = globalThis.originalLyricsCursor; delete globalThis.originalLyricsCursor; delete globalThis.lyricsCursor; });
  await application.evaluate(({ Tray }) => { Tray.prototype.setContextMenu = globalThis.originalTrayMenu; delete globalThis.originalTrayMenu; delete globalThis.reviewTrayMenu; });
  // Minimizing retains playback and lyrics; closing the main window exits.
  await page.keyboard.press('Escape'); await overlay.getByRole('button', { name: '播放或暂停', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('audio').paused);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('http:')).focus());
  await assertOverlayTopmost('main window focused');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('http:')).minimize());
  const before = Number(await overlay.locator('#current').getAttribute('data-time')); await sleep(400);
  assert(Number(await overlay.locator('#current').getAttribute('data-time')) > before + 100);
  const actualTime = await page.locator('audio').evaluate(audio => audio.currentTime * 1000 - 1000);
  assert(Math.abs(Number(await overlay.locator('#current').getAttribute('data-time')) - actualTime) < 220, '2x playback uses actual media time while hidden');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('http:')).isMinimized()), true);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === '慢听 · 桌面歌词').isAlwaysOnTop()), true);
  await assertOverlayTopmost('main window minimized');
  await page.evaluate(() => window.slowTuneDesktop.updateLyricsPreferences({ locked: true }));
  await assertOverlayTopmost('locked while main window minimized');
  await page.evaluate(() => window.slowTuneDesktop.updateLyricsPreferences({ locked: false }));
  await assertOverlayTopmost('unlocked while main window minimized');
  await overlay.getByRole('button', { name: '下一首', exact: true }).click(); await overlay.getByText('下一首歌词', { exact: true }).waitFor();
  await page.evaluate(sourceKey => window.slowTuneDesktop.publishClock({ sourceKey, position: 900, playing: true }), originalSource);
  await sleep(100); assert(Number(await overlay.locator('#current').getAttribute('data-time')) < 10000, 'late clock from the previous source is rejected');
  assert.equal(await page.locator('audio').count(), 1); assert.equal(fixture.preparations.length, preparations + 1);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined'); assert.equal(await overlay.evaluate(() => typeof window.require), 'undefined');
  await closeDesktop(application, { mainWindow: true }); application = undefined;
  assert.equal(stops, 1); assert.equal(alive(backend.pid), false); assert.equal(existsSync(stateFile), false);
  const saved = JSON.parse(readFileSync(join(data, 'desktop-state.json'), 'utf8'));
  assert.equal(saved.lyrics.visible, true); assert.equal(saved.lyrics.locked, false); assert.equal(saved.lyrics.fontSize, 34); assert.equal(saved.overlayBounds.x, 120); assert.equal(saved.overlayBounds.y, 140);
  application = await launch(); const restored = await windowAt(application, url => url.endsWith('/lyrics.html'));
  assert.equal(await restored.evaluate(() => window.slowTuneLyrics.getState().then(state => state.preferences.fontSize)), 34);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === '慢听 · 桌面歌词').isVisible()), false, 'restoring without active lyrics keeps the native window hidden');
  await restored.evaluate(() => window.slowTuneLyrics.updatePreferences({ visible: false }));
  await closeDesktop(application); application = undefined;
  assert.equal(JSON.parse(readFileSync(join(data, 'desktop-state.json'), 'utf8')).lyricsDefaultsVersion, 1);
  application = await launch(); const remembered = await windowAt(application, url => url.startsWith('http:'));
  assert.equal(await remembered.evaluate(() => window.slowTuneDesktop.getState().then(state => state.preferences.visible)), false);
  assert.equal(application.windows().some(page => page.url().endsWith('/lyrics.html')), false, 'manual close persists across restart');
  await remembered.getByRole('button', { name: '设置', exact: true }).click();
  await remembered.getByRole('navigation', { name: '设置分组', exact: true }).getByRole('button', { name: '本地资料', exact: true }).click();
  await remembered.getByRole('button', { name: '打开资料文件夹', exact: true }).waitFor();
  assert.equal(await remembered.getByRole('button', { name: '启动与访问', exact: true }).count(), 0);
  assert.equal(await remembered.getByRole('button', { name: '切换服务配置…', exact: true }).count(), 0);
  await closeDesktop(application); application = undefined;
  assert.equal(alive(backend.pid), false); assert.equal(stops, 3);
  assert.deepEqual(errors, []);
});
