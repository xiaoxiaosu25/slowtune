import { test } from 'node:test';
import { desktopBuildDirectory, developmentPaths } from '../scripts/workspace-paths.mjs';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, utimesSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { preferences, restoreLyricsPreferences, windowAppearance, fitBounds, lyricDocument, lyricClock, currentLines } from '../desktop/model.mjs';
import { ensureService, stopService, createDesktopSession } from '../desktop/service.mjs';
import { floatingLineEnd, floatingLinePan } from '../desktop/lyric-layout.mjs';

const root = resolve('.'), artifacts = join(developmentPaths().testRuntime, 'desktop-tests'); mkdirSync(artifacts, { recursive: true });
const sleep = ms => new Promise(done => setTimeout(done, ms));
test('desktop lyrics enable once on upgrade and remember an explicit close afterwards', () => {
  assert.equal(restoreLyricsPreferences().visible, true);
  assert.equal(restoreLyricsPreferences({ lyrics: { visible: false, fontSize: 40, locked: true } }).visible, true);
  assert.deepEqual(restoreLyricsPreferences({ lyricsDefaultsVersion: 1, lyrics: { visible: false, fontSize: 40, locked: true } }), preferences({ visible: false, fontSize: 40, locked: true }));
  assert.deepEqual(windowAppearance({ theme: 'dark', mode: 'immersive', url: 'file:///private' }), { theme: 'dark', mode: 'immersive' });
  assert.equal(windowAppearance({ theme: '#ffffff', mode: 'standard' }), null);
  assert.equal(windowAppearance({ theme: 'light', mode: 'arbitrary' }), null);
});
async function freePort() { const listener = createServer(); await new Promise(done => listener.listen(0, '127.0.0.1', done)); const port = listener.address().port; await new Promise(done => listener.close(done)); return port; }

test('desktop boundary validates snapshots, real word timing, clock source and off-screen preferences', () => {
  const prefs = preferences({ visible: true, locked: true, fontSize: 500, highlight: 'url(file:///secret)', unknown: '/secret', lines: 3 });
  assert.equal(prefs.fontSize, 64); assert.equal(prefs.highlight, '#f4cd87'); assert.equal(prefs.lines, 2); assert(!('unknown' in prefs));
  assert.deepEqual(fitBounds({ x: 9000, y: -9000, width: 9000, height: 190 }, { x: -1920, y: 0, width: 1920, height: 1040 }, { width: 420, height: 150 }, { width: 920, height: 190 }), { x: -1920, y: 0, width: 1920, height: 190 });
  const doc = lyricDocument({ sourceKey: 'a', title: 'test', offsetMs: 1000, synced: true, lines: [{ startMs: 2000, text: '第一句' }, { startMs: 5000, text: '听风', words: [{ text: '听', startMs: 5000, endMs: 6000 }, { text: '风', startMs: 6000, endMs: 7000 }] }] });
  assert.equal(currentLines(doc, { sourceKey: 'a', position: 2.5 }).index, -1);
  assert.equal(currentLines(doc, { sourceKey: 'a', position: 6.2 }).index, 1);
  assert.equal(currentLines(doc, { sourceKey: 'a', position: 3.2 }).index, 0);
  assert.equal(currentLines(doc, { sourceKey: 'old', position: 100 }).index, -1);
  assert.equal(doc.lines[0].words, undefined); assert.equal(doc.lines[1].words[1].startMs, 6000);
  assert.equal(lyricDocument({ ...doc, lines: [{ text: 'invalid', startMs: NaN }] }), null);
  assert.equal(lyricDocument({ ...doc, lines: Array(5001).fill(doc.lines[0]) }), null);
  assert.equal(lyricClock({ sourceKey: 'a', position: Infinity, playing: true }), null);
  assert.equal(lyricClock({ sourceKey: 'a', position: 1, playing: true, url: 'secret' }).url, undefined);
  const last=lyricDocument({...doc,durationMs:9000});
  assert.equal(last.durationMs,9000);assert.equal(floatingLineEnd(last,1),8000,'last line ends at media duration minus saved offset');
  assert.equal(floatingLineEnd(doc,1),7000,'real word end is the fallback when media duration is unknown');
  assert.equal(floatingLinePan(8000,5000,floatingLineEnd(last,1),200),-200);
  assert.equal(lyricDocument({...doc,durationMs:Infinity}).durationMs,undefined);
});

test('desktop takes over a legacy service, refreshes stale builds and stops only its selected process', { timeout: 90000 }, async t => {
  const work = mkdtempSync(join(artifacts, 'lifecycle-')), product = join(work, 'product'); mkdirSync(product);
  cpSync(join(resolve(process.env.MUSIC_APP_TEST_BUILD ?? desktopBuildDirectory()), 'dist'), join(product, 'dist'), { recursive: true });
  cpSync(join(root, 'scripts'), join(product, 'scripts'), { recursive: true }); cpSync(join(root, 'package.json'), join(product, 'package.json')); symlinkSync(join(root, 'node_modules'), join(product, 'node_modules'), 'junction');
  const config = { host: '127.0.0.1', port: await freePort(), allowedHosts: ['localhost', '127.0.0.1'], accessKey: 'isolated-desktop-test', userSpace: 'desktop-test', database: join(work, 'data/library.sqlite'), runtimeDirectory: join(work, 'runtime'), mediaLeaseTtlMs: 85000 };
  const file = join(work, 'config.local.json'); writeFileSync(file, JSON.stringify(config));
  t.after(async () => {
    const stateFile = join(config.runtimeDirectory, 'service.json');
    if (!existsSync(stateFile)) return;
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    await fetch(`http://127.0.0.1:${config.port}/internal/stop`, { method: 'POST', headers: { 'X-Control-Key': state.key } });
    for (let n = 0; n < 100 && existsSync(stateFile); n++) await sleep(100);
    assert.equal(existsSync(stateFile), false);
  });
  const first = await ensureService(product, file); assert.equal(first.action, 'started');
  assert.equal((await fetch(first.url + '/api/song-library')).status, 401);
  assert.equal((await fetch(first.url + '/internal/desktop-session', { method: 'POST' })).status, 403);
  assert.equal((await fetch(first.url + '/internal/desktop-session', { method: 'POST', headers: { 'X-Control-Key': 'wrong' } })).status, 403);
  await assert.rejects(createDesktopSession(product, file, first.pid + 1), /归属校验失败/);
  const session = await createDesktopSession(product, file, first.pid);
  assert.equal(session.url, first.url); assert.match(session.cookie, /^[\w-]{43}$/); assert.equal(session.key, undefined);
  assert.equal((await fetch(first.url + '/api/song-library', { headers: { Cookie: 'music_session=' + session.cookie } })).status, 200);
  const repeated = await ensureService(product, file); assert.equal(repeated.action, 'already-running'); assert.equal(repeated.url, first.url);
  const marker = JSON.parse(readFileSync(join(config.runtimeDirectory, 'desktop-service.json'), 'utf8'));
  const changed = join(work, 'other-config.local.json'); writeFileSync(changed, JSON.stringify({ ...config, database: join(work, 'other.sqlite') }));
  await assert.rejects(ensureService(product, changed), /其他配置使用/); assert.equal(existsSync(join(work, 'other.sqlite.song-library.sqlite')), false);
  await assert.rejects(stopService(product, changed), /服务归属无法确认/);
  await assert.rejects(createDesktopSession(product, changed, first.pid), /归属校验失败/);
  unlinkSync(join(config.runtimeDirectory, 'desktop-service.json'));
  const adopted = await ensureService(product, file); assert.equal(adopted.action, 'started'); assert.notEqual(adopted.pid, marker.pid);
  assert.throws(() => process.kill(marker.pid, 0));
  const artifact = join(product, 'dist/client/index.html'); utimesSync(artifact, new Date(), new Date(Date.now() + 2000));
  const refreshed = await ensureService(product, file); assert.equal(refreshed.action, 'restarted'); assert.notEqual(refreshed.pid, adopted.pid);
  assert.throws(() => process.kill(adopted.pid, 0));
  await stopService(product, file, adopted.pid);
  assert.doesNotThrow(() => process.kill(refreshed.pid, 0), 'an old desktop session cannot stop a replacement process');
  const occupied = createServer(socket => socket.end()); const port = await freePort(); await new Promise(done => occupied.listen(port, '127.0.0.1', done));
  try { const conflict = join(work, 'conflict.local.json'); writeFileSync(conflict, JSON.stringify({ ...config, port, runtimeDirectory: join(work, 'conflict-runtime'), database: join(work, 'conflict.sqlite') })); await assert.rejects(ensureService(product, conflict), /已被其它服务占用/); assert.equal(existsSync(join(work, 'conflict.sqlite.song-library.sqlite')), false); }
  finally { await new Promise(done => occupied.close(done)); }
  assert.deepEqual(await stopService(product, file, refreshed.pid), { stopped: true });
});
