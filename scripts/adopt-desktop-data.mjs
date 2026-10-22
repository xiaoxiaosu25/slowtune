import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, renameSync, rmdirSync, lstatSync } from 'node:fs';
import { join, resolve, dirname, basename, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { desktopDataDirectory, readState, alive } from '../desktop/lifecycle.mjs';
import { desktopBuildDirectory } from './workspace-paths.mjs';
import { resolveConfigFile } from './instance-path.mjs';
import { stopDesktopForRestart } from './desktop.mjs';
import { desktopServiceHost, stopServiceForRestart } from '../desktop/service.mjs';
import { localProfilePath, validateLocalProfile, availablePort } from '../desktop/profile.mjs';
import { DesktopStorage } from '../desktop/storage.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)), run = promisify(execFile);
const disjoint = (a, b) => { const value = relative(resolve(a), resolve(b)); return isAbsolute(value) || value === '..' || value.startsWith('..' + sep); };
export function isUnadoptedStartup(target) {
  if (!existsSync(target)) return false;
  const allowed = ['profile', 'cache', 'logs', 'desktop-state.json', 'desktop-runtime.json'];
  if (!readdirSync(target).every(name => allowed.includes(name))) return false;
  try { return readFileSync(join(target, 'logs/desktop-launch.log'), 'utf8').includes('原桌面资料尚未接入，未创建空资料。'); } catch { return false; }
}
function sqliteSummary(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('资料数据库检查未通过。');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
    return Object.fromEntries(tables.map(name => [name, db.prepare('SELECT COUNT(*) AS n FROM "' + name.replaceAll('"', '""') + '"').get().n]));
  } finally { db.close(); }
}
function copy(source, destination) {
  if (lstatSync(source).isSymbolicLink()) throw new Error('资料接入不接受目录或文件链接。');
  cpSync(source, destination, { recursive: true, errorOnExist: true, force: false, filter: file => { if (lstatSync(file).isSymbolicLink()) throw new Error('资料接入不接受目录或文件链接。'); return true; } });
}

/** Copy current-format data once. The caller must have stopped both owners. */
export async function adoptDesktopData({ sourceConfig, oldProfile, target, serviceRoot, extractPreferences }) {
  sourceConfig = resolve(sourceConfig); oldProfile = oldProfile && resolve(oldProfile); target = resolve(target);
  if (existsSync(target) && readdirSync(target).length) throw new Error('目标 data 目录已有内容，未覆盖或合并。');
  const config = JSON.parse(readFileSync(sourceConfig, 'utf8')), originalRoot = dirname(sourceConfig);
  const database = resolve(originalRoot, config.database), runtime = resolve(originalRoot, config.runtimeDirectory);
  if (!disjoint(dirname(database), target) || !disjoint(runtime, target) || oldProfile && (!disjoint(oldProfile, target) || !disjoint(target, oldProfile))) throw new Error('源资料和目标目录必须分开。');
  const state = readState(join(runtime, 'service.json'));
  if (alive(state?.pid)) throw new Error('源资料仍在运行，请先有序停止源实例。');
  if (oldProfile && alive(readState(join(oldProfile, 'desktop-runtime.json'))?.pid)) throw new Error('原桌面仍在运行。');
  const stage = target + '.adopting-' + randomUUID();
  mkdirSync(join(stage, 'backups/initial'), { recursive: true });
  const backup = join(stage, 'backups/initial');
  try {
    copy(sourceConfig, join(backup, 'config.local.json'));
    mkdirSync(join(backup, 'library')); mkdirSync(join(stage, 'library'));
    const databases = readdirSync(dirname(database)).filter(name => name === basename(database) || name.startsWith(basename(database) + '.'));
    if (!databases.includes(basename(database) + '.song-library.sqlite')) throw new Error('没有找到当前格式的歌曲资料，未创建空资料。');
    for (const name of databases) {
      copy(join(dirname(database), name), join(backup, 'library', name));
      copy(join(backup, 'library', name), join(stage, 'library', 'library.sqlite' + name.slice(basename(database).length)));
    }
    if (existsSync(runtime)) copy(runtime, join(backup, 'runtime'));
    mkdirSync(join(stage, 'runtime')); mkdirSync(join(stage, 'logs'));
    const account = join(runtime, 'bilibili-account.dpapi.json');
    if (existsSync(account)) copy(account, join(stage, 'runtime/bilibili-account.dpapi.json'));
    if (oldProfile && existsSync(oldProfile)) {
      copy(oldProfile, join(backup, 'profile'));
      // Retain the entire original profile in the backup. Only activate browser
      // files, never its selected configuration or stale process/control records.
      mkdirSync(join(stage, 'profile'));
      for (const name of readdirSync(join(backup, 'profile'))) {
        if (['instance', 'desktop-state.json', 'desktop-runtime.json', 'desktop-launch.log'].includes(name) || name.startsWith('Singleton')) continue;
        copy(join(backup, 'profile', name), join(stage, 'profile', name));
      }
      const previous = readState(join(oldProfile, 'desktop-state.json'));
      if (previous) { delete previous.configFile; writeFileSync(join(stage, 'desktop-state.json'), JSON.stringify(previous, null, 2) + '\n', { mode: 0o600 }); }
      if (extractPreferences) { await extractPreferences(stage, `http://${desktopServiceHost(config)}:${config.port}`); renameSync(join(stage, 'adopted-preferences.json'), join(stage, 'preferences.json')); }
    }
    let port = await availablePort(); while (port === config.port) port = await availablePort();
    const next = { ...config, port, host: '127.0.0.1', allowedHosts: ['localhost', '127.0.0.1'], accessKey: randomBytes(32).toString('base64url'), database: '../library/library.sqlite', runtimeDirectory: '../runtime', logDirectory: '../logs' };
    if (config.ytDlp) next.ytDlp = { ...config.ytDlp, executable: resolve(originalRoot, config.ytDlp.executable), nodeRuntime: resolve(originalRoot, config.ytDlp.nodeRuntime) };
    mkdirSync(dirname(localProfilePath(stage)), { recursive: true });
    writeFileSync(localProfilePath(stage), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 }); validateLocalProfile(stage);
    new DesktopStorage(stage);
    for (const name of databases.filter(name => name.endsWith('.sqlite'))) {
      const before = sqliteSummary(join(backup, 'library', name)), after = sqliteSummary(join(stage, 'library', 'library.sqlite' + name.slice(basename(database).length)));
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('资料复制后的数量不一致。');
    }
    const { SongLibraryStore } = await import(pathToFileURL(join(serviceRoot, 'dist/server/song-library-store.js')).href);
    const store = new SongLibraryStore(join(stage, 'library/library.sqlite.song-library.sqlite'), config.userSpace);
    let counts;
    try {
      const current = store.read(), snapshot = current.document.snapshot;
      counts = { songs: snapshot.songs.length, playlists: snapshot.playlists.length, favorites: snapshot.favorites.length, versions: snapshot.versions.length };
      if (current.document.syncLinks.some(link => link.state === 'ready')) store.transaction(current.revision, context => {
        for (const link of context.document.syncLinks) if (link.state === 'ready') { link.state = 'review'; link.issues = ['paused']; context.events.push({ type: 'sync-review', linkId: link.id }); }
      });
    } finally { store.close(); }
    writeFileSync(join(stage, 'adoption.json'), JSON.stringify({ version: 1, completedAt: new Date().toISOString(), counts, backup: 'backups/initial', synchronizationPaused: true }, null, 2) + '\n');
    if (existsSync(target)) rmdirSync(target); // Empty only; never recursively remove user data.
    renameSync(stage, target);
    return { data: target, counts, backup: join(target, 'backups/initial') };
  } catch (error) { throw new Error(`资料接入失败，原资料保留；检查目录 ${stage}。原因：${error.message}`); }
}

if (import.meta.main) {
  if (process.argv.length > 2) throw new Error('此入口只接入当前桌面选择的资料，不接收任意目录参数。');
  const oldProfile = process.env.MUSIC_APP_LEGACY_DESKTOP_DATA || join(process.env.APPDATA, 'SlowTune');
  const sourceConfig = readState(join(oldProfile, 'desktop-state.json'))?.configFile || resolveConfigFile();
  const target = desktopDataDirectory(), serviceRoot = desktopBuildDirectory();
  const scaffold = isUnadoptedStartup(target);
  if (existsSync(target) && readdirSync(target).length && !scaffold) throw new Error('目标 data 目录已有内容，未停止任何实例或覆盖资料。');
  const { default: electron } = await import('electron');
  let previousStartup;
  if (scaffold) {
    await stopDesktopForRestart({ root, data: target, electron, environment: { ...process.env, MUSIC_APP_DESKTOP_DATA: target } });
    previousStartup = target + '.adopting-startup-' + randomUUID();
    if (dirname(previousStartup) !== dirname(target) || !disjoint(target, previousStartup) || lstatSync(target).isSymbolicLink()) throw new Error('启动文件保留目录无效。');
    renameSync(target, previousStartup);
  }
  try {
  await stopDesktopForRestart({ root, data: oldProfile, electron, environment: process.env });
  await stopServiceForRestart(serviceRoot, sourceConfig, root);
  const result = await adoptDesktopData({ sourceConfig, oldProfile, target, serviceRoot, extractPreferences: async (data, origin) => {
    const env = { ...process.env, SLOWTUNE_ADOPT_DATA: data, SLOWTUNE_ADOPT_ORIGIN: origin }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
    await run(electron, [join(root, 'desktop/adopt-preferences.mjs')], { env, windowsHide: true, timeout: 45000, maxBuffer: 65536 });
  } });
  if (previousStartup) renameSync(previousStartup, join(target, 'backups/initial/previous-startup'));
  console.log(JSON.stringify(result));
  } catch (error) { if (previousStartup && !existsSync(target)) renameSync(previousStartup, target); throw error; }
}
