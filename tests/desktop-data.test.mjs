import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, renameSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { developmentPaths, desktopBuildDirectory } from '../scripts/workspace-paths.mjs';
import { desktopDataDirectory } from '../desktop/lifecycle.mjs';
import { ensureLocalProfile, prepareLocalProfile, validateLocalProfile } from '../desktop/profile.mjs';
import { DesktopStorage } from '../desktop/storage.mjs';
import { adoptDesktopData, isUnadoptedStartup } from '../scripts/adopt-desktop-data.mjs';
import electron from 'electron';

const root = resolve('.'), build = resolve(process.env.MUSIC_APP_TEST_BUILD ?? desktopBuildDirectory()), output = join(developmentPaths().testRuntime, 'desktop-data-tests'); mkdirSync(output, { recursive: true });
const { SongLibraryStore } = await import(pathToFileURL(join(build, 'dist/server/song-library-store.js')).href);
const { SongLibraryService } = await import(pathToFileURL(join(build, 'dist/server/song-library-service.js')).href);

test('desktop owns its paths and chooses a new private port without touching an occupied service', async t => {
  const data = mkdtempSync(join(output, 'paths with spaces-'));
  assert.equal(desktopDataDirectory({}, root), join(root, 'data'));
  const file = await ensureLocalProfile(data), config = validateLocalProfile(data);
  const occupied = createServer(); await new Promise(done => occupied.listen(config.port, '127.0.0.1', done)); t.after(() => new Promise(done => occupied.close(done)));
  await prepareLocalProfile(data); const next = validateLocalProfile(data); assert.notEqual(config.port, next.port); assert(occupied.listening);
  const external = mkdtempSync(join(output, 'another-instance-')); symlinkSync(external, join(data, 'linked'), 'junction');
  writeFileSync(file, JSON.stringify({ ...next, database: '../linked/library.sqlite' })); assert.throws(() => validateLocalProfile(data), /链接/);
  writeFileSync(file, JSON.stringify({ ...next, database: '../../external.sqlite' })); assert.throws(() => validateLocalProfile(data), /超出/);
});

test('desktop preference writes are durable across relocation, reject unrelated keys, and report corrupt storage', async () => {
  const directory = mkdtempSync(join(output, 'preferences-')), data = join(directory, 'data'), moved = join(directory, 'moved'); mkdirSync(data);
  const storage = new DesktopStorage(data); await storage.write('slow-listening:theme:v1', 'dark'); await storage.write('slow-listening:playback:v3', '{"items":[]}');
  await storage.write('slow-listening:discovery:v1:youtube%3AJP', '{"view":"covers"}');
  assert.throws(() => storage.write('../credentials', 'secret'), /无效/);
  const snapshot = storage.read(); snapshot['slow-listening:theme:v1'] = 'light'; assert.equal(storage.read()['slow-listening:theme:v1'], 'dark');
  renameSync(data, moved); assert.equal(new DesktopStorage(moved).read()['slow-listening:theme:v1'], 'dark');
  writeFileSync(join(moved, 'preferences.json'), '{broken'); assert.throws(() => new DesktopStorage(moved));
});

test('only a known failed first startup is eligible for preservation before adoption', () => {
  const data = mkdtempSync(join(output, 'failed-first-open-')); mkdirSync(join(data, 'logs')); mkdirSync(join(data, 'profile'));
  assert.equal(isUnadoptedStartup(data), false);
  writeFileSync(join(data, 'logs/desktop-launch.log'), '原桌面资料尚未接入，未创建空资料。'); assert.equal(isUnadoptedStartup(data), true);
  writeFileSync(join(data, 'preferences.json'), '{}'); assert.equal(isUnadoptedStartup(data), false);
});

test('adoption backs up current data and pauses only the copy, never overwrites a populated target', async () => {
  const directory = mkdtempSync(join(output, 'adoption-')), original = join(directory, 'original'), target = join(directory, 'data'); mkdirSync(original);
  const database = join(original, 'library.sqlite.song-library.sqlite'), store = new SongLibraryStore(database, 'personal'), service = new SongLibraryService(store);
  service.execute(null, [{ type: 'create-playlist', name: '原来的歌单' }]);
  const current = store.read(); store.transaction(current.revision, context => { context.document.syncLinks.push({ id: 'link', accountId: '1', folderId: '2', targetId: 'system:favorites', state: 'ready', issues: [] }); }); store.close();
  const sourceConfig = join(original, 'config.local.json'); writeFileSync(sourceConfig, JSON.stringify({ userSpace: 'personal', port: 4187, accessKey: 'original-secret', host: '0.0.0.0', allowedHosts: ['localhost'], database: 'library.sqlite', runtimeDirectory: 'runtime' }));
  const result = await adoptDesktopData({ sourceConfig, target, serviceRoot: build }); assert.equal(result.counts.playlists, 1); assert(existsSync(join(result.backup, 'library/library.sqlite.song-library.sqlite')));
  const copied = new SongLibraryStore(join(target, 'library/library.sqlite.song-library.sqlite'), 'personal'), unchanged = new SongLibraryStore(database, 'personal');
  try { assert.equal(copied.read().document.syncLinks[0].state, 'review'); assert.equal(unchanged.read().document.syncLinks[0].state, 'ready'); } finally { copied.close(); unchanged.close(); }
  assert.notEqual(validateLocalProfile(target).accessKey, 'original-secret');
  assert.notEqual(validateLocalProfile(target).port, 4187, 'the desktop copy does not reserve the server edition port');
  await assert.rejects(adoptDesktopData({ sourceConfig, target, serviceRoot: build }), /已有内容/);
});

test('adoption extracts preferences from the original IPv4 or localhost origin without contacting a service', { timeout: 90000 }, async () => {
  const data = mkdtempSync(join(output, 'electron-storage-')), oldProfile = join(data, 'legacy'), original = join(data, 'original'), seed = join(data, 'seed.cjs');
  mkdirSync(original);
  const store = new SongLibraryStore(join(original, 'library.sqlite.song-library.sqlite'), 'personal'); store.close();
  const preferences = {
    'http://127.0.0.1:41987': { 'slow-listening:theme:v1': 'light', 'slow-listening:playback:v3': '{"items":["ipv4"]}' },
    'http://localhost:41987': { 'slow-listening:theme:v1': 'dark', 'slow-listening:playback:v3': '{"items":["localhost"]}' },
  };
  writeFileSync(seed, `const{app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(oldProfile)});app.whenReady().then(async()=>{const s=session.fromPartition('persist:slowtune-player');s.protocol.handle('http',()=>new Response('<html></html>',{headers:{'Content-Type':'text/html'}}));const w=new BrowserWindow({show:false,webPreferences:{session:s}});for(const[origin,values]of Object.entries(${JSON.stringify(preferences)})){await w.loadURL(origin);await w.webContents.executeJavaScript('for(const[key,value]of Object.entries('+JSON.stringify(values)+'))localStorage.setItem(key,value)');}s.flushStorageData();w.destroy();app.quit();});`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  await promisify(execFile)(electron, [seed], { env, windowsHide: true, timeout: 25000 });
  for (const [name, host, allowedHosts, origin] of [
    ['ipv4', '127.0.0.1', ['localhost', '127.0.0.1'], 'http://127.0.0.1:41987'],
    ['localhost-only', '127.0.0.1', ['localhost'], 'http://localhost:41987'],
    ['ipv6', '::1', ['localhost', '127.0.0.1'], 'http://localhost:41987'],
  ]) {
    const sourceConfig = join(original, 'config.local.json'), target = join(data, name);
    writeFileSync(sourceConfig, JSON.stringify({ host, allowedHosts, port: 41987, accessKey: 'isolated-adoption-test', userSpace: 'personal', database: 'library.sqlite', runtimeDirectory: 'runtime' }));
    await adoptDesktopData({ sourceConfig, oldProfile, target, serviceRoot: build, extractPreferences: async (stage, selectedOrigin) => {
      await promisify(execFile)(electron, [join(root, 'desktop/adopt-preferences.mjs')], { env: { ...env, SLOWTUNE_ADOPT_DATA: stage, SLOWTUNE_ADOPT_ORIGIN: selectedOrigin }, windowsHide: true, timeout: 25000 });
    } });
    assert.deepEqual(new DesktopStorage(target).read(), preferences[origin], name + ' retains the original theme and queue');
  }
});
