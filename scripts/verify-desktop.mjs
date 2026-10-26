import { _electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { developmentPaths } from './workspace-paths.mjs';

const executable = process.argv[2] && resolve(process.argv[2]);
if (!executable || !existsSync(executable)) throw new Error('请提供要验证的 Windows 免安装包 SlowTune.exe 绝对路径。');
const delivery = JSON.parse(readFileSync(join(dirname(executable), 'desktop-delivery.json'), 'utf8'));
const output = join(developmentPaths().testRuntime, 'desktop-package-verification'); mkdirSync(output, { recursive: true });
const portableData = process.argv.includes('--portable-data');
const directory = mkdtempSync(join(output, 'run-')), data = portableData ? join(dirname(executable), 'data') : join(directory, 'profile');
if (portableData && existsSync(data)) throw new Error('默认资料验收只允许在新解压且没有 data 的程序副本中执行。');
const env = { ...process.env, MUSIC_APP_DESKTOP_DATA: data };
if (portableData) delete env.MUSIC_APP_DESKTOP_DATA;
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
for (const name of ['MUSIC_APP_CONFIG', 'MUSIC_APP_NODE', 'MUSIC_APP_DESKTOP_ROOT', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']) delete env[name];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const launch = () => _electron.launch({ executablePath: executable, env, timeout: 30000 });
const step = message => console.log('桌面包验证：' + message);
async function verifyPlayback(page) {
  // Keep upstream accounts and content outside the deterministic package check.
  const calls = [];
  const ref = { provider: 'bilibili', kind: 'video', id: 'BV0000000001', part: '1' };
  const entry = { ref, resourceId: 'desktop-verification', title: '桌面包合成音频', durationSeconds: 15, url: 'https://www.bilibili.com/video/' + ref.id };
  const format = { id: 'wav', codec: 'pcm', mimeType: 'audio/wav', container: 'wav' };
  const audio = Buffer.alloc(44 + 8000 * 15 * 2);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  for (let n = 0; n < 8000 * 15; n++) audio.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * n / 8000) * 1000), 44 + n * 2);
  await page.route('**/__desktop-verification.wav', route => { calls.push('audio'); return route.fulfill({ contentType: 'audio/wav', body: audio }); });
  await page.route('**/api/search', route => route.fulfill({ json: { items: [entry] } }));
  await page.route('**/v1/call/*', route => {
    const request = route.request().postDataJSON();
    calls.push(new URL(route.request().url()).pathname);
    if ((request?.ref ?? request?.request?.ref)?.id !== ref.id) return route.continue();
    const operation = new URL(route.request().url()).pathname.split('/').at(-1);
    if (operation === 'formats') return route.fulfill({ json: { protocol: 2, result: [format] } });
    if (operation === 'metadata') return route.fulfill({ json: { protocol: 2, result: entry } });
    if (operation === 'prepare') return route.fulfill({ json: { protocol: 2, result: { entry, resourceId: entry.resourceId, format, delivery: { url: new URL('/__desktop-verification.wav', page.url()).href, requiresHost: false } } } });
    return route.continue();
  });
  await page.getByRole('button', { name: '开始搜索', exact: true }).click();
  const search = page.getByRole('dialog', { name: '搜索音乐', exact: true });
  await search.getByLabel('弹窗搜索关键词').fill(entry.title);
  await search.getByRole('button', { name: '搜索', exact: true }).click();
  await page.locator('audio').evaluate(element => { element.muted = true; });
  await search.getByRole('button', { name: '播放 ' + entry.title, exact: true }).click();
  await search.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .2, undefined, { timeout: 20000 }).catch(async error => {
    const state = await page.locator('audio').evaluate(element => ({ readyState: element.readyState, currentTime: element.currentTime, paused: element.paused, error: element.error?.message }));
    const alerts = await page.getByRole('alert').allTextContents();
    throw new Error('合成播放未就绪：' + JSON.stringify({ calls, state, alerts }), { cause: error });
  });
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  const toggle = page.locator('.listening-transport .play-toggle');
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('audio')?.paused === true);
  await page.locator('audio').evaluate(element => { element.currentTime = 3; });
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 3.2 && !document.querySelector('audio').paused);
  await toggle.click();
  const result = await page.locator('audio').evaluate(element => ({ duration: element.duration, error: element.error?.code ?? null, paused: element.paused }));
  assert.equal(result.error, null); assert.equal(result.paused, true); assert(Math.abs(result.duration - 15) < .1);
  step('合成音频经搜索和播放入口完成解码、暂停、跳转与继续播放');
}
async function closeApplication(value) {
  let wrapper;
  try { wrapper = value.process(); } catch { return; }
  const pid = await value.evaluate(() => process.pid).catch(() => null);
  if (!pid) { wrapper?.kill(); return; }
  const closing = value.evaluate(({ BrowserWindow, app }) => {
    const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('http:'));
    if (main) main.close();
    else app.quit();
  }).catch(() => {}), deadline = Date.now() + 45000;
  let exited = false;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { exited = true; break; }
    await sleep(100);
  }
  // Playwright launches Windows GUI apps through cmd.exe. A detached service can
  // keep that console wrapper alive after Electron itself has exited. Observe the
  // actual Electron PID first, then close only the test wrapper.
  if (wrapper && wrapper.pid !== pid) wrapper.kill();
  if (!exited) { try { process.kill(pid); } catch {} throw new Error('桌面进程退出超过 45 秒'); }
  await Promise.race([closing, sleep(2000)]);
}
async function playerWindow(application) {
  for (let n = 0; n < 350; n++) { const page = application.windows().find(page => /^http:\/\/(127\.0\.0\.1|localhost):/.test(page.url())); if (page) return page; await sleep(100); }
  throw new Error('桌面页面未就绪：' + JSON.stringify(await Promise.all(application.windows().map(async page => ({ url: page.url(), text: (await page.locator('body').innerText()).slice(0, 800) })))));
}
let application, config, state, report;
try {
  step('无配置首次启动，自动准备本机资料');
  application = await launch();
  assert.equal(await application.evaluate(() => /nodejs/i.test(process.env.PATH ?? '')), false);
  const page = await playerWindow(application);
  step('本机服务和主窗口已就绪');
  config = JSON.parse(readFileSync(join(data, 'instance/config.local.json'), 'utf8'));
  state = JSON.parse(readFileSync(join(data, 'runtime/service.json'), 'utf8'));
  await page.getByRole('button', { name: '打开正在播放', exact: true }).waitFor({ timeout: 20000 });
  assert.equal(await application.evaluate(({ app }) => app.getVersion()), delivery.version);
  assert.equal(await page.evaluate(() => fetch('/api/status').then(response => response.json()).then(status => status.version)), delivery.version);
  assert.equal(await page.getByLabel('服务访问码', { exact: true }).count(), 0);
  assert.equal(application.windows().some(window => window.url().endsWith('/setup.html')), false);
  assert.equal((await fetch(page.url() + 'api/song-library')).status, 401, 'ordinary browser access still needs authentication');
  assert.equal((await fetch(page.url() + 'internal/desktop-session', { method: 'POST' })).status, 403);
  assert.equal(await page.evaluate(() => document.cookie.includes('music_session')), false, 'desktop session stays HttpOnly');
  step('无需选择配置或输入访问码，已直接进入播放器');
  await page.screenshot({ path: join(directory, 'packaged-desktop.png') });
  await page.evaluate(async initialCode => {
    const access = await fetch('/api/settings/access').then(response => response.json());
    const response = await fetch('/api/settings/access', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Music-App': '1' }, body: JSON.stringify({ revision: access.revision, currentAccessKey: initialCode, newAccessKey: 'changed-desktop-browser-code', authenticationRequired: true }) });
    if (!response.ok) throw new Error('browser access settings update failed: ' + response.status);
    await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Music-App': '1' }, body: '{}' });
  }, config.accessKey);
  await page.reload();
  await page.getByRole('button', { name: '打开正在播放', exact: true }).waitFor({ timeout: 20000 });
  assert.equal(await page.getByLabel('服务访问码', { exact: true }).count(), 0);
  step('会话失效后自动恢复，浏览器访问码变更不影响本机启动');
  await verifyPlayback(page);
  const created = await page.evaluate(async () => {
    const current = await fetch('/api/song-library').then(response => response.json());
    const response = await fetch('/api/song-library/edits', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Music-App': '1' }, body: JSON.stringify({ revision: current.revision, edits: [{ type: 'create-playlist', name: '独立桌面交付验收' }] }) });
    if (!response.ok) throw new Error('isolated library write failed: ' + response.status);
    return response.json();
  });
  assert(created.snapshot.playlists.some(list => list.name === '独立桌面交付验收'));
  step('独立资料写入通过，检查重复启动');
  await promisify(execFile)(executable, [], { env, windowsHide: true, timeout: 12000 });
  assert.equal(application.windows().filter(page => page.url().startsWith('http:')).length, 1);
  step('重复启动通过，退出主应用');
  const firstPID = state.pid, base = page.url();
  await closeApplication(application); application = undefined;
  step('已退出，检查服务已关闭并重新打开');
  assert.equal(existsSync(join(data, 'runtime/service.json')), false);
  assert.throws(() => process.kill(firstPID, 0));
  await assert.rejects(fetch(base));
  application = await launch(); const reopened = await playerWindow(application);
  step('重新打开通过，核对资料');
  await reopened.getByRole('button', { name: '打开正在播放', exact: true }).waitFor({ timeout: 20000 });
  const restored = await reopened.evaluate(() => fetch('/api/song-library').then(response => response.json()));
  assert.deepEqual(restored, created);
  assert.notEqual(JSON.parse(readFileSync(join(data, 'runtime/service.json'), 'utf8')).pid, firstPID);
  assert.equal(await application.evaluate(({ app }) => app.isPackaged), true);
  assert.equal(await reopened.getByLabel('服务访问码', { exact: true }).count(), 0);
  report = { status: 'passed', packaged: true, portableDefaultData: portableData, nodeOnPath: false, controlledAudioPlayback: true, createdIndependentProfile: true, automaticFirstLaunch: true, accessCodePrompt: false, automaticSessionRestore: true, browserAccessProtected: true, authenticated: true, dataSurvivesReopen: true, duplicateLaunchSingleWindow: true, closeStopsService: true, serviceRestartsOnReopen: true, executable };
} finally {
  let cleanupError;
  if (application) await closeApplication(application).catch(error => { cleanupError = error; });
  if (!config && existsSync(join(data, 'instance/config.local.json'))) config = JSON.parse(readFileSync(join(data, 'instance/config.local.json'), 'utf8'));
  if (!state && existsSync(join(data, 'runtime/service.json'))) state = JSON.parse(readFileSync(join(data, 'runtime/service.json'), 'utf8'));
  if (config && existsSync(join(data, 'runtime/service.json'))) {
    state = JSON.parse(readFileSync(join(data, 'runtime/service.json'), 'utf8'));
    await fetch(`http://127.0.0.1:${config.port}/internal/stop`, { method: 'POST', headers: { 'X-Control-Key': state.key } });
    const stateFile = join(data, 'runtime/service.json'); for (let n = 0; n < 100 && existsSync(stateFile); n++) await sleep(100);
    assert.equal(existsSync(stateFile), false, 'the isolated verification service was stopped');
  }
  if (cleanupError) throw cleanupError;
}
writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Windows 免安装包隔离验证通过：' + directory);
