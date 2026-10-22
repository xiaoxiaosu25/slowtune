import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import electron from 'electron';
import { _electron } from 'playwright-core';
import { desktopBuildDirectory, developmentPaths } from '../scripts/workspace-paths.mjs';
import { ensureLocalProfile, validateLocalProfile } from '../desktop/profile.mjs';
import { alive, closeDesktop } from './helpers/desktop-process.mjs';
import { seedSongs, queueRecord } from './helpers/song-fixture.mjs';
import { lyricWindowState } from './helpers/windows-window-state.mjs';

const root = resolve('.'), build = resolve(process.env.MUSIC_APP_TEST_BUILD ?? desktopBuildDirectory());
const load = name => import(pathToFileURL(join(build, 'dist/server', name + '.js')).href);
const { SongLibraryStore } = await load('song-library-store');
const { LyricsStore } = await load('lyrics-store');
const { FollowStore } = await load('follow-store');
const { SourceSettingsStore } = await load('source-settings');
const { SearchSettingsStore } = await load('search-settings');
const { StartupSettingsStore } = await load('startup-settings');
const { RecommendationStore } = await load('recommendation');
const { BilibiliCredentials } = await load('bilibili-credentials');
const signal = new AbortController().signal;

// Compare complete table contents (including scopes and sync intents), not file
// bytes: opening SQLite may legitimately change WAL/checkpoint representation.
function sqliteSnapshot(data) {
  const library = join(data, 'library'), result = {};
  for (const file of readdirSync(library).filter(file => file.endsWith('.sqlite'))) {
    const db = new DatabaseSync(join(library, file), { readOnly: true });
    try {
      assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check), ['ok'], file);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], file);
      result[file] = Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => {
        assert.match(name, /^\w+$/);
        return [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map(row => ({ ...row }))];
      }));
    } finally { db.close(); }
  }
  assert(Object.keys(result).length >= 5, 'all persistent SQLite stores are included');
  return result;
}

test('complete data backup restores current stores, synthetic DPAPI credentials and desktop preferences across two real launches', { timeout: 150000 }, async t => {
  const output = join(developmentPaths().testRuntime, 'desktop-restore-tests'); mkdirSync(output, { recursive: true });
  const directory = mkdtempSync(join(output, 'full data 中文-')), original = join(directory, 'original data'), restored = join(directory, 'restored data'), serviceRoot = join(directory, 'service');
  const configFile = await ensureLocalProfile(original), config = validateLocalProfile(original);
  mkdirSync(join(original, 'library')); mkdirSync(join(original, 'runtime'));
  const database = join(original, 'library/library.sqlite');
  const ref = { provider: 'bilibili', kind: 'video', id: 'BV1tX4y1W7Xm', part: '900' };
  const track = { ref, resourceId: 'restore-track', title: '隔离恢复歌曲', artists: ['测试演唱者'], url: 'https://www.bilibili.com/video/' + ref.id };
  const store = new SongLibraryStore(database + '.song-library.sqlite', config.userSpace);
  const snapshot = seedSongs({ favorites: [track], playlists: [{ id: 'restore-playlist', name: '恢复歌单', entries: [track] }] });
  // Persist a user-disabled catalogue lookup so background enrichment cannot
  // intentionally change the library while this test compares restored rows.
  snapshot.songs[0].desktopCatalog = { state: 'disabled', checkedAt: 1 };
  snapshot.versions.push({ ...structuredClone(snapshot.versions[0]), id: 'alternate-version', ref: { ...ref, part: '901' }, label: '现场版', kind: 'live' });
  snapshot.songs[0].defaultVersionId = 'alternate-version'; snapshot.playlists[0].entries[0].pinnedVersionId = 'version-0';
  const savedLibrary = store.transaction(null, context => {
    context.document.snapshot = snapshot;
    context.document.origins = [{ member: { kind: 'favorite', favoriteId: 'favorite-0' }, local: 'present' }, { member: { kind: 'playlist-entry', playlistId: 'restore-playlist', entryId: 'restore-playlist-0' }, local: 'present' }];
    context.document.syncLinks = [{ id: 'isolated-link', accountId: '999999999', folderId: '888888888', targetId: 'system:favorites', state: 'review', issues: ['paused'] }];
    context.document.syncMappings = [{ linkId: 'isolated-link', member: { kind: 'favorite', favoriteId: 'favorite-0' }, bvid: ref.id, versionId: 'version-0' }];
    context.events.push({ type: 'sync-intent', linkId: 'isolated-link', bvid: ref.id, action: 'add' });
  }); store.close();
  const lyrics = new LyricsStore(database + '.lyrics.sqlite', config.userSpace);
  const lyric = lyrics.update(ref, null, state => { state.offsetMs = -750; state.document = { provider: 'local', id: 'restore-lyric', title: track.title, artists: track.artists, synced: true, lines: [{ startMs: 1000, text: '完整恢复的歌词', translation: 'Restored lyrics' }] }; }, signal); lyrics.close();
  const follows = new FollowStore(database + '.follows.sqlite', config.userSpace);
  const followed = follows.change(follows.read().revision, { provider: 'bilibili', id: '999999999', name: '隔离关注', url: 'https://space.bilibili.com/999999999', followedAt: 123 }, true, signal); follows.close();
  const sources = new SourceSettingsStore(database + '.settings.sqlite', config.userSpace);
  const sourceSettings = sources.save({ revision: sources.read().revision, youtube: { enabled: false, disabledDisplay: 'hide' } }); sources.close();
  const search = new SearchSettingsStore(database + '.settings.sqlite', config.userSpace);
  const searchSettings = search.saveConfig(search.read().revision, { ...search.read().config, strictMatch: false, excludeTerms: ['隔离排除'] }); search.close();
  const recommendations = new RecommendationStore(database + '.recommendation.sqlite', config.userSpace);
  const recommendation = recommendations.update('music-recommendation', recommendations.read('music-recommendation'), { overrides: { order: 'random' } }, signal); recommendations.close();
  const image = 'data:image/png;base64,' + readFileSync(join(root, 'public/assets/coast.png')).toString('base64');
  const startup = new StartupSettingsStore(database + '.settings.sqlite', config.userSpace, config.accessKey);
  const welcome = startup.saveWelcome({ revision: startup.welcome().revision, welcome: { ...startup.welcome().welcome, background: 'custom', desktopFocus: { x: 31, y: 62 }, shade: 42, position: 'right' }, image }); startup.close();
  const synthetic = { provider: 'bilibili', revision: 'isolated-restore-only', cookie: 'SESSDATA=synthetic-offline-restore-only' };
  await new BilibiliCredentials(join(original, 'runtime/bilibili-account.dpapi.json'), 'bilibili:' + config.userSpace).write('bilibili:' + config.userSpace, synthetic, signal);

  // Use the real host/router/storage with all upstream fetches blocked before
  // importing the entry point. No login or remote favorite operation is used.
  mkdirSync(join(serviceRoot, 'dist'), { recursive: true });
  cpSync(join(build, 'dist/server'), join(serviceRoot, 'dist/server'), { recursive: true });
  symlinkSync(join(build, 'dist/client'), join(serviceRoot, 'dist/client'), 'junction');
  symlinkSync(join(root, 'node_modules'), join(serviceRoot, 'node_modules'), 'junction');
  cpSync(join(build, 'scripts'), join(serviceRoot, 'scripts'), { recursive: true });
  cpSync(join(build, 'package.json'), join(serviceRoot, 'package.json'));
  renameSync(join(serviceRoot, 'dist/server/index.js'), join(serviceRoot, 'dist/server/index-real.js'));
  writeFileSync(join(serviceRoot, 'dist/server/index.js'), `globalThis.fetch = async () => { throw new Error('isolated restore blocks upstream'); }; await import('./index-real.js');`);
  let application;
  t.after(async () => { if (application) await closeDesktop(application); });
  const launch = async (data, startupError) => {
    const env = { ...process.env, MUSIC_APP_CONFIG: '', MUSIC_APP_DESKTOP_DATA: data, MUSIC_APP_DESKTOP_ROOT: serviceRoot, MUSIC_APP_NODE: process.execPath };
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
    application = await _electron.launch({ executablePath: electron, args: [join(root, 'desktop'), '--force-device-scale-factor=1'], env, timeout: 25000 });
    const page = await application.firstWindow(); page.setDefaultTimeout(15000);
    await page.route(/^https?:\/\//, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    if (startupError) await page.getByText(startupError, { exact: true }).waitFor({ timeout: 35000 });
    else await page.getByRole('button', { name: '打开正在播放', exact: true }).waitFor({ timeout: 35000 });
    return page;
  };
  const json = (page, path, body) => page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Music-App': '1' }, body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(path + ': ' + response.status);
    return response.json();
  }, { path, body });
  let page = await launch(original);
  const savedPrefs = { 'slow-listening:theme:v1': 'dark', 'slow-listening:playback:v3': JSON.stringify(queueRecord([track], { volume: .37, rate: 1.25, order: 'sequential', repeat: 'one' })) };
  const lyricPrefs = { visible: true, locked: true, fontSize: 38, color: '#ddeeff', highlight: '#a6e9c5', lines: 1, translations: false };
  await page.evaluate(async ({ savedPrefs, lyricPrefs, welcome, image }) => {
    for (const [key, value] of Object.entries(savedPrefs)) await window.slowTuneDesktop.writePreference(key, value);
    await window.slowTuneDesktop.updateLyricsPreferences(lyricPrefs);
    await window.slowTuneDesktop.saveWelcome({ settings: welcome.welcome, image });
    window.slowTuneDesktop.setWindowAppearance({ theme: 'dark', mode: 'standard' });
  }, { savedPrefs, lyricPrefs, welcome, image });
  // Let the actual player read and bind the queue before taking its backup.
  await page.reload();
  await page.getByRole('button', { name: '打开正在播放', exact: true }).waitFor();
  await application.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http:')); w.setBounds({ x: 110, y: 100, width: 1100, height: 700 }); BrowserWindow.getAllWindows().find(w => w.getTitle() === '慢听 · 桌面歌词').setPosition(150, 180); });
  await closeDesktop(application, { mainWindow: true }); application = undefined;
  assert.equal(existsSync(join(original, 'runtime/service.json')), false);
  assert.equal(existsSync(join(original, 'desktop-runtime.json')), false);
  const baseline = sqliteSnapshot(original), desktopState = JSON.parse(readFileSync(join(original, 'desktop-state.json'), 'utf8'));
  const persistedPrefs = JSON.parse(readFileSync(join(original, 'preferences.json'), 'utf8')), cachedWelcome = readFileSync(join(original, 'welcome.json'), 'utf8');
  // The backup itself happens only after both desktop and service have exited.
  cpSync(original, restored, { recursive: true });
  assert.deepEqual(sqliteSnapshot(restored), baseline);
  const occupied = createServer(); await new Promise(done => occupied.listen(config.port, '127.0.0.1', done));
  t.after(() => new Promise(done => occupied.close(done)));
  const unrelated = { pid: process.pid, port: config.port, key: 'synthetic-unrelated-control' };
  writeFileSync(join(restored, 'runtime/service.json'), JSON.stringify(unrelated));
  await launch(restored, '桌面运行目录正被其他实例使用，未接管或关闭该实例。');
  await closeDesktop(application); application = undefined;
  assert(alive(process.pid)); assert(occupied.listening);
  assert.deepEqual(JSON.parse(readFileSync(join(restored, 'runtime/service.json'), 'utf8')), unrelated);
  // Dead records copied from a previous session must not reserve a port or own
  // the restored service. The unrelated live PID case above must fail closed.
  const dead = 2147483647; assert.equal(alive(dead), false);
  writeFileSync(join(restored, 'runtime/service.json'), JSON.stringify({ pid: dead, port: config.port, key: 'synthetic-stale-control' }));
  writeFileSync(join(restored, 'runtime/desktop-service.json'), JSON.stringify({ pid: dead, identity: 'synthetic-old-location', starting: true }));
  writeFileSync(join(restored, 'desktop-runtime.json'), JSON.stringify({ pid: dead, port: config.port, key: 'synthetic-old-desktop' }));
  let selectedPort;
  for (let opening = 0; opening < 2; opening++) {
    page = await launch(restored);
    const selected = validateLocalProfile(restored);
    assert.notEqual(selected.port, config.port); if (opening) assert.equal(selected.port, selectedPort); selectedPort = selected.port;
    assert.equal(selected.userSpace, config.userSpace); assert.equal(selected.database, config.database);
    assert.equal(await page.evaluate(() => window.slowTuneDesktop.getDataDirectory()), restored);
    assert.deepEqual(await page.evaluate(() => window.slowTuneDesktop.readPreferences()), persistedPrefs);
    assert.deepEqual(await page.evaluate(() => window.slowTuneDesktop.getState().then(state => state.preferences)), lyricPrefs);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(await page.locator('audio').evaluate(audio => audio.paused), true, 'restored queue remains silent');
    assert.deepEqual(await json(page, '/api/song-library'), { modelVersion: 1, revision: savedLibrary.revision, snapshot: savedLibrary.document.snapshot });
    assert.deepEqual(await json(page, '/api/follows'), followed);
    const selectedSources = await json(page, '/api/settings/sources');
    assert.equal(selectedSources.revision, sourceSettings.revision); assert.equal(selectedSources.youtube.enabled, false); assert.equal(selectedSources.youtube.disabledDisplay, 'hide');
    assert.deepEqual(await json(page, '/api/settings/search'), searchSettings);
    assert.deepEqual(await json(page, '/api/lyrics/state', { ref }), lyric);
    assert.deepEqual(await json(page, '/api/settings/welcome'), welcome);
    const imageBytes = await page.evaluate(id => fetch('/api/welcome/image/' + id).then(r => r.arrayBuffer()).then(b => Array.from(new Uint8Array(b))), welcome.welcome.imageId);
    assert.deepEqual(Buffer.from(imageBytes), readFileSync(join(root, 'public/assets/coast.png')));
    const native = await lyricWindowState(application); assert.equal(native.electron.visible, false); assert.equal(native.native.topmost, true, 'restored locked hidden window retains native topmost');
    const bounds = await application.evaluate(({ BrowserWindow }) => ({ player: BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http:')).getBounds(), overlay: BrowserWindow.getAllWindows().find(w => w.getTitle() === '慢听 · 桌面歌词').getBounds() }));
    assert.deepEqual(bounds.player, desktopState.windowBounds); assert.deepEqual(bounds.overlay, desktopState.overlayBounds);
    const active = JSON.parse(readFileSync(join(restored, 'runtime/service.json'), 'utf8'));
    assert.notEqual(active.pid, dead); assert.equal(active.port, selectedPort);
    await closeDesktop(application, { mainWindow: true }); application = undefined;
    assert.equal(alive(active.pid), false); assert.equal(existsSync(join(restored, 'runtime/service.json')), false); assert.equal(existsSync(join(restored, 'desktop-runtime.json')), false);
    assert.deepEqual(sqliteSnapshot(restored), baseline);
    assert.equal(readFileSync(join(restored, 'welcome.json'), 'utf8'), cachedWelcome);
    const credentials = await new BilibiliCredentials(join(restored, 'runtime/bilibili-account.dpapi.json'), 'bilibili:' + config.userSpace).open();
    assert.equal(credentials.loadFailed, false); assert.deepEqual(await credentials.read('bilibili:' + config.userSpace, signal), synthetic);
    const rec = new RecommendationStore(join(restored, 'library/library.sqlite.recommendation.sqlite'), config.userSpace);
    try { assert.deepEqual(rec.read('music-recommendation'), recommendation); } finally { rec.close(); }
    assert(occupied.listening, 'the unrelated listener remains untouched');
  }
  assert.deepEqual(sqliteSnapshot(original), baseline, 'restoring never writes to the original data');
});
