import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createServer, createConnection } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import electron from 'electron';
import { _electron } from 'playwright-core';
import { desktopBuildDirectory, developmentPaths } from '../scripts/workspace-paths.mjs';
import { ensureLocalProfile } from '../desktop/profile.mjs';
import { alive, closeDesktop } from './helpers/desktop-process.mjs';

const root = resolve('.'), run = promisify(execFile), sleep = ms => new Promise(done => setTimeout(done, ms));
async function player(application) {
  for (let n = 0; n < 400; n++) { const page = application.windows().find(page => page.url().startsWith('http:')); if (page) { await page.getByRole('button', { name: '打开正在播放', exact: true }).waitFor(); return page; } await sleep(50); }
  throw new Error('桌面未打开：' + JSON.stringify(await Promise.all(application.windows().map(page => page.locator('body').innerText()))));
}

test('desktop isolates the server edition, preserves data and preferences across port changes and relocation, and shuts down completely', { timeout: 150000 }, async t => {
  const output = join(developmentPaths().testRuntime, 'desktop-tests'); mkdirSync(output, { recursive: true });
  const directory = mkdtempSync(join(output, 'independent-lifecycle-')), file = join(directory, 'config.local.json');
  const listener = createServer(); await new Promise(done => listener.listen(0, '127.0.0.1', done)); const port = listener.address().port; await new Promise(done => listener.close(done));
  const config = { host: '127.0.0.1', port, allowedHosts: ['localhost', '127.0.0.1'], accessKey: 'server-edition-fixture', userSpace: 'server-fixture', database: './server-data/library.sqlite', runtimeDirectory: './server-runtime' };
  writeFileSync(file, JSON.stringify(config));
  const sourceState = join(directory, 'server-runtime/service.json'), serviceRoot = resolve(process.env.MUSIC_APP_TEST_BUILD ?? desktopBuildDirectory());
  const data = join(directory, 'data'), ownFile = await ensureLocalProfile(data), ownConfig = JSON.parse(readFileSync(ownFile, 'utf8'));
  writeFileSync(ownFile, JSON.stringify({ ...ownConfig, port }));
  const env = { ...process.env, MUSIC_APP_CONFIG: file, MUSIC_APP_NODE: process.execPath, MUSIC_APP_DESKTOP_ROOT: serviceRoot, MUSIC_APP_DESKTOP_DATA: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  let application, occupied;
  t.after(async () => {
    if (application) await closeDesktop(application);
    if (occupied) await new Promise(done => occupied.close(done));
    if (existsSync(sourceState)) { const state = JSON.parse(readFileSync(sourceState)); if (alive(state.pid)) { await fetch(`http://127.0.0.1:${port}/internal/stop`, { method: 'POST', headers: { 'X-Control-Key': state.key } }); for (let n = 0; n < 300 && alive(state.pid); n++) await sleep(50); } }
  });
  await run(process.execPath, [join(serviceRoot, 'scripts/launch.mjs'), '--no-open'], { env, windowsHide: true, timeout: 45000 });
  const server = JSON.parse(readFileSync(sourceState));
  const launch = () => _electron.launch({ executablePath: electron, args: [join(root, 'desktop')], env, timeout: 30000 });
  application = await launch(); const page = await player(application), desktopPort = Number(new URL(page.url()).port);
  assert.notEqual(desktopPort, port); assert(alive(server.pid));
  assert.equal(await page.getByLabel('服务访问码', { exact: true }).count(), 0);
  assert.equal(application.windows().filter(page => page.url().startsWith('http:')).length, 1);
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), join(data, 'profile'));
  const stateFile = resolve(dirname(ownFile), ownConfig.runtimeDirectory, 'service.json'), first = JSON.parse(readFileSync(stateFile)); assert.notEqual(first.pid, server.pid);
  const saved = await page.evaluate(async () => {
    window.slowTuneDesktop.writePreference('slow-listening:theme:v1', 'dark');
    window.slowTuneDesktop.writePreference('slow-listening:youtube-music:region:v1', 'JP');
    const current = await fetch('/api/song-library').then(response => response.json());
    return fetch('/api/song-library/edits', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Music-App': '1' }, body: JSON.stringify({ revision: current.revision, edits: [{ type: 'create-playlist', name: '独立桌面歌单' }] }) }).then(response => response.json());
  });
  assert(saved.snapshot.playlists.some(playlist => playlist.name === '独立桌面歌单'));
  const login = await fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Music-App': '1' }, body: JSON.stringify({ accessKey: config.accessKey }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const remote = await fetch(`http://127.0.0.1:${port}/api/song-library`, { headers: { Cookie: cookie } }).then(response => response.json()); assert.equal(remote.snapshot.playlists.length, 0);
  await run(electron, [join(root, 'desktop')], { env, windowsHide: true, timeout: 12000 }); assert.equal(application.windows().filter(page => page.url().startsWith('http:')).length, 1);
  const unfinished = createConnection({ host: '127.0.0.1', port: desktopPort }); unfinished.on('error', () => {}); await new Promise(done => unfinished.once('connect', done)); unfinished.write('GET /api/status HTTP/1.1\r\nHost: 127.0.0.1\r\n');
  await closeDesktop(application, { mainWindow: true }); application = undefined; unfinished.destroy();
  assert.equal(alive(first.pid), false); assert.equal(existsSync(stateFile), false); assert(alive(server.pid));
  const shutdown = JSON.parse(readFileSync(join(data, 'runtime/last-shutdown.json'))); assert.equal(shutdown.delivery.activeReads, 0); assert.equal(shutdown.sources.pending, 0);
  occupied = createServer(); await new Promise(done => occupied.listen(desktopPort, '127.0.0.1', done));
  application = await launch(); const reopened = await player(application); assert.notEqual(Number(new URL(reopened.url()).port), desktopPort);
  assert.equal(await reopened.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await reopened.evaluate(() => window.slowTuneDesktop.readPreferences().then(values => values['slow-listening:youtube-music:region:v1'])), 'JP');
  assert.deepEqual(await reopened.evaluate(() => fetch('/api/song-library').then(response => response.json())), saved);
  await closeDesktop(application); application = undefined; await new Promise(done => occupied.close(done)); occupied = undefined;
  const moved = join(directory, 'moved data'); renameSync(data, moved); env.MUSIC_APP_DESKTOP_DATA = moved;
  application = await launch(); const relocated = await player(application); assert.equal(await relocated.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.deepEqual(await relocated.evaluate(() => fetch('/api/song-library').then(response => response.json())), saved);
  const crashed = JSON.parse(readFileSync(join(moved, 'runtime/service.json'))); process.kill(crashed.pid, 'SIGKILL'); for (let n = 0; n < 100 && alive(crashed.pid); n++) await sleep(50);
  await closeDesktop(application, { mainWindow: true }); application = undefined;
  application = await launch(); await application.firstWindow(); await closeDesktop(application); application = undefined;
  assert.equal(existsSync(join(moved, 'runtime/service.json')), false); assert(alive(server.pid));
});
