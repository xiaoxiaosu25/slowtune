import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import electron from 'electron';
import { _electron } from 'playwright-core';
import { developmentPaths, desktopBuildDirectory } from '../scripts/workspace-paths.mjs';
import { alive, closeDesktop } from './helpers/desktop-process.mjs';

const output = join(developmentPaths().testRuntime, 'desktop-state-recovery-tests');
async function fixture(t) {
  mkdirSync(output, { recursive: true }); const data = mkdtempSync(join(output, 'isolated-'));
  const env = { ...process.env, MUSIC_APP_DESKTOP_DATA: data, MUSIC_APP_DESKTOP_ROOT: resolve(process.env.MUSIC_APP_TEST_BUILD ?? desktopBuildDirectory()), MUSIC_APP_NODE: process.execPath };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  let application; const cleanup = [];
  const launch = async () => {
    application = await _electron.launch({ executablePath: electron, args: [join(resolve('.'), 'desktop')], env, timeout: 25000 });
    const page = await application.firstWindow(); page.setDefaultTimeout(15000);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, route => route.abort());
    await application.evaluate(({ dialog }) => { globalThis.quitErrors = []; dialog.showErrorBox = (title, message) => globalThis.quitErrors.push({ title, message }); });
    return page;
  };
  t.after(async () => { for (const repair of cleanup) await repair(); if (application) await closeDesktop(application); rmSync(data, { recursive: true, force: true }); });
  return { data, cleanup, launch, app: () => application, close: async () => { await closeDesktop(application); application = undefined; } };
}
async function ready(page) {
  try { await page.getByRole('button', { name: '打开正在播放', exact: true }).waitFor({ timeout: 35000 }); }
  catch (error) { throw new Error('隔离桌面未就绪：' + await page.locator('body').innerText(), { cause: error }); }
}

test('corrupt, invalid and unreadable desktop state remain untouched through window events, retries and quit', { timeout: 100000 }, async t => {
  for (const [input, expected] of [['{broken', 'JSON 已损坏'], ['[]', '格式无效'], [null, '读取失败']]) {
    const f = await fixture(t), file = join(f.data, 'desktop-state.json');
    if (input === null) mkdirSync(file); else writeFileSync(file, input);
    const page = await f.launch(); await page.getByRole('button', { name: '重试', exact: true }).waitFor();
    assert.match(await page.locator('#status').innerText(), new RegExp(expected));
    await f.app().evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1100, 700); w.emit('move'); });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.waitForTimeout(500);
    assert.equal(existsSync(join(f.data, 'instance/config.local.json')), false, 'no service/profile starts with an unreadable state');
    assert.equal(existsSync(file + '.tmp'), false);
    if (input !== null) assert.equal(readFileSync(file, 'utf8'), input);
    await f.close();
    if (input !== null) assert.equal(readFileSync(file, 'utf8'), input); else assert(existsSync(file));
  }
});

test('preserving a damaged file under another name enables explicit retry and normal reopen', { timeout: 65000 }, async t => {
  const f = await fixture(t), file = join(f.data, 'desktop-state.json'); writeFileSync(file, '{keep this original');
  const page = await f.launch(); await page.getByRole('button', { name: '重试', exact: true }).waitFor();
  renameSync(file, file + '.retained');
  await page.getByRole('button', { name: '重试', exact: true }).click(); await ready(page);
  await page.evaluate(() => window.slowTuneDesktop.updateLyricsPreferences({ fontSize: 42, locked: true }));
  await f.close(); assert.equal(readFileSync(file + '.retained', 'utf8'), '{keep this original');
  const reopened = await f.launch(); await ready(reopened);
  assert.equal(await reopened.evaluate(() => window.slowTuneDesktop.getState().then(state => state.preferences.fontSize)), 42);
  await f.close();
});

test('welcome save rejection is visible, preserves last file, and retry plus immediate exit saves the newest artwork', { timeout: 65000 }, async t => {
  const f = await fixture(t), page = await f.launch(); await ready(page);
  const file = join(f.data, 'welcome.json'); await page.evaluate(() => window.slowTuneDesktop.flushPreferences());
  const old = readFileSync(file, 'utf8'); mkdirSync(file + '.tmp');
  f.cleanup.push(() => rmSync(file + '.tmp', { recursive: true, force: true }));
  const settings = { background: 'plain', position: 'right', desktopFocus: { x: 21, y: 62 }, shade: 42 };
  assert.match(await page.evaluate(settings => window.slowTuneDesktop.saveWelcome({ settings }).then(() => 'unexpected success', error => error.message), settings), /尚未保存/);
  await page.getByRole('button', { name: '重试保存偏好', exact: true }).waitFor();
  assert.equal(readFileSync(file, 'utf8'), old);
  rmSync(file + '.tmp', { recursive: true });
  await page.getByRole('button', { name: '重试保存偏好', exact: true }).click();
  await page.getByRole('button', { name: '重试保存偏好', exact: true }).waitFor({ state: 'hidden' });
  assert.deepEqual(JSON.parse(readFileSync(file)).settings, settings);
  await page.evaluate(settings => { void window.slowTuneDesktop.saveWelcome({ settings: { ...settings, position: 'left' } }); }, settings);
  await f.close(); assert.equal(JSON.parse(readFileSync(file)).settings.position, 'left');
});

test('stop ownership failure leaves a released player on an explicit retry-exit page, then stops only the owned service', { timeout: 65000 }, async t => {
  const f = await fixture(t), page = await f.launch(); await ready(page);
  const marker = join(f.data, 'runtime/desktop-service.json'), original = readFileSync(marker, 'utf8');
  const service = JSON.parse(readFileSync(join(f.data, 'runtime/service.json')));
  writeFileSync(marker, JSON.stringify({ ...JSON.parse(original), identity: 'controlled-ownership-mismatch' }));
  f.cleanup.push(() => { if (existsSync(marker)) writeFileSync(marker, original); });
  await page.evaluate(() => { window.slowTuneDesktop.quit(); window.slowTuneDesktop.quit(); });
  await page.getByRole('button', { name: '重试保存并退出', exact: true }).waitFor();
  assert.match(await page.locator('#status').innerText(), /停止内部服务.*播放器已释放.*停止尚未确认/s);
  assert(alive(service.pid)); assert.equal(f.app().windows().filter(page => page.url().startsWith('http:')).length, 0);
  assert.equal(await page.locator('audio').count(), 0);
  writeFileSync(marker, original);
  await page.getByRole('button', { name: '重试保存并退出', exact: true }).click(); await f.close();
  assert.equal(alive(service.pid), false);
});

test('state modified as the service stops survives a final write failure and retries after service shutdown', { timeout: 65000 }, async t => {
  const f = await fixture(t), page = await f.launch(); await ready(page);
  await page.evaluate(() => window.slowTuneDesktop.flushPreferences());
  const file = join(f.data, 'desktop-state.json'), old = readFileSync(file, 'utf8');
  f.cleanup.push(() => rmSync(file + '.tmp', { recursive: true, force: true }));
  const service = JSON.parse(readFileSync(join(f.data, 'runtime/service.json')));
  // A native fs watcher injects a real temporary-path failure exactly when this
  // isolated service removes its record, before its stop helper completes.
  await f.app().evaluate(({ BrowserWindow }, data) => {
    const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
    globalThis.quitWatcher = fs.watch(path.join(data, 'runtime'), (_event, name) => {
      if (name !== 'service.json' || fs.existsSync(path.join(data, 'runtime/service.json'))) return;
      globalThis.quitWatcher.close();
      fs.mkdirSync(path.join(data, 'desktop-state.json.tmp'));
      const w = BrowserWindow.getAllWindows().find(w => w.getTitle() !== '慢听 · 桌面歌词');
      globalThis.stopWaitPage = w.webContents.getURL();
      w.setSize(1120, 720); w.emit('resize');
    });
  }, f.data);
  await page.evaluate(() => window.slowTuneDesktop.quit());
  await page.getByRole('button', { name: '重试保存并退出', exact: true }).waitFor();
  assert.match(await page.locator('#status').innerText(), /内部服务停止后保存.*播放器已释放.*内部服务已停止/s);
  assert.equal(alive(service.pid), false); assert.equal(readFileSync(file, 'utf8'), old);
  assert.match(await f.app().evaluate(() => globalThis.stopWaitPage), /\/setup\.html$/, 'the normal player was already unloaded during service shutdown');
  assert.equal(f.app().windows().some(page => page.url().startsWith('http:')), false);
  const latestBounds = await f.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/setup.html')).getBounds());
  assert.notEqual(latestBounds.width, JSON.parse(old).windowBounds?.width, 'the native window contains the new modification');
  rmSync(file + '.tmp', { recursive: true });
  await page.getByRole('button', { name: '重试保存并退出', exact: true }).click(); await f.close();
  assert.deepEqual(JSON.parse(readFileSync(file)).windowBounds, latestBounds, 'retry persists the latest actual native bounds, including Windows scale rounding');
});

test('release rejection and missing acknowledgement show a disabled player and allow retrying exit without repeating release', { timeout: 65000 }, async t => {
  for (const outcome of ['rejected', 'timeout']) {
    const f = await fixture(t), page = await f.launch(); await ready(page);
    const service = JSON.parse(readFileSync(join(f.data, 'runtime/service.json')));
    await f.app().evaluate(({ BrowserWindow }, outcome) => {
      const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http:'));
      const send = w.webContents.send.bind(w.webContents); globalThis.releaseCalls = 0;
      w.webContents.send = (channel, ...args) => {
        if (channel === 'desktop:command' && args[0] === 'release') {
          globalThis.releaseCalls++;
          if (outcome === 'rejected') void w.webContents.executeJavaScript('window.slowTuneDesktop.playbackReleased(false)');
          return;
        }
        return send(channel, ...args);
      };
    }, outcome);
    await page.evaluate(() => window.slowTuneDesktop.quit());
    await page.getByRole('button', { name: '重试保存并退出', exact: true }).waitFor();
    assert.match(await page.locator('#status').innerText(), /释放播放器.*已停用，释放尚未确认/s);
    assert.match(readFileSync(join(f.data, 'logs/desktop-launch.log'), 'utf8'), outcome === 'rejected' ? /播放器释放失败/ : /未在规定时间内确认/);
    assert(alive(service.pid)); assert.equal(f.app().windows().some(page => page.url().startsWith('http:')), false);
    assert.equal(await f.app().evaluate(() => globalThis.releaseCalls), 1);
    await page.getByRole('button', { name: '重试保存并退出', exact: true }).click(); await f.close();
    assert.equal(alive(service.pid), false);
  }
});

test('a failed save while quitting during startup has an available retry-exit action', { timeout: 65000 }, async t => {
  const f = await fixture(t), temporary = join(f.data, 'desktop-state.json.tmp'); mkdirSync(temporary);
  f.cleanup.push(() => rmSync(temporary, { recursive: true, force: true }));
  const page = await f.launch();
  await f.app().evaluate(({ app }) => app.quit());
  await page.getByRole('button', { name: '重试保存并退出', exact: true }).waitFor();
  assert.match(await page.locator('#status').innerText(), /释放播放器前保存.*播放器尚未释放/s);
  assert.equal(existsSync(join(f.data, 'desktop-state.json')), false);
  rmSync(temporary, { recursive: true });
  await page.getByRole('button', { name: '重试保存并退出', exact: true }).click(); await f.close();
  assert.equal(existsSync(join(f.data, 'desktop-state.json')), true);
  assert.equal(existsSync(join(f.data, 'runtime/service.json')), false);
});
