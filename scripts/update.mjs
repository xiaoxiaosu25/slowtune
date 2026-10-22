import { cpSync, existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { resolveConfigFile } from './instance-path.mjs';
import { openBrowser } from './launch.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sleep = ms => new Promise(done => setTimeout(done, ms));
const readJSON = file => JSON.parse(readFileSync(file, 'utf8'));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
const inside = (parent, child) => { const path = relative(parent, child); return path !== '' && path !== '..' && !path.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(path); };
const requireCondition = (value, message) => { if (!value) throw new Error(message); };

async function portBusy(host, port) {
  return new Promise((done, reject) => {
    const socket = createConnection({ host, port });
    const finish = (error, busy) => { socket.destroy(); error ? reject(error) : done(busy); };
    socket.setTimeout(1500, () => finish(new Error('检查实例端口超时，未开始更新。')));
    socket.once('connect', () => finish(null, true));
    socket.once('error', error => error.code === 'ECONNREFUSED' ? finish(null, false) : finish(error));
  });
}

function run(command, args, env, capture = false) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] });
    let stdout = '', stderr = '';
    if (capture) { child.stdout.on('data', value => stdout += value); child.stderr.on('data', value => stderr += value); }
    child.once('error', reject);
    child.once('close', code => code === 0 ? done(stdout) : reject(new Error(stderr.trim() || `${basename(command)} 执行失败（退出码 ${code}）。`)));
  });
}

function inventory(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const path = join(directory, entry.name);
    requireCondition(!entry.isSymbolicLink(), `备份范围内有链接，无法确认完整副本：${path}`);
    return entry.isDirectory() ? inventory(path) : [path];
  });
}

function copyVerified(source, target) {
  cpSync(source, target, { recursive: true, force: false, errorOnExist: true });
  const files = inventory(source);
  for (const file of files) requireCondition(readFileSync(file).equals(readFileSync(join(target, relative(source, file)))), `备份文件校验失败：${file}`);
  return files.length;
}

function checkDatabases(instance, backup) {
  const checks = [];
  for (const file of inventory(instance).filter(file => file.endsWith('.sqlite'))) {
    const copy = join(backup, relative(instance, file));
    const original = new DatabaseSync(file, { readOnly: true });
    let saved;
    try {
      saved = new DatabaseSync(copy, { readOnly: true });
      for (const db of [original, saved]) requireCondition(db.prepare('PRAGMA quick_check').get().quick_check === 'ok', `数据库完整性检查失败：${file}`);
      const tables = original.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      for (const { name } of tables) {
        const sql = 'SELECT * FROM "' + name.replaceAll('"', '""') + '"';
        const statement = db => { const query = db.prepare(sql); query.setReadBigInts(true); return query.all(); };
        requireCondition(isDeepStrictEqual(statement(original), statement(saved)), `数据库备份内容不一致：${file} / ${name}`);
      }
      checks.push({ file: relative(instance, file), tables: tables.length, integrity: 'ok' });
    } finally { original.close(); saved?.close(); }
  }
  return checks;
}

export function installInstanceLauncher(instance, sourceRoot = root, configName = 'config.local.json') {
  const source = relative(instance, sourceRoot).replaceAll('/', '\\');
  requireCondition(!/[\r\n"%]/u.test(source + configName), '实例与源码路径无法用于 CMD 更新入口。');
  const sourcePath = isAbsolute(source) ? source : '%~dp0' + source;
  const launcher = entry => `@echo off\r\nchcp 65001 >nul\r\nsetlocal\r\nset "MUSIC_APP_CONFIG=%~dp0${configName}"\r\ncall "${sourcePath}\\${entry}" %*\r\nexit /b %errorlevel%\r\n`;
  const serviceLauncher = `@echo off\r\nchcp 65001 >nul\r\nsetlocal\r\nset "MUSIC_APP_CONFIG=%~dp0${configName}"\r\nnode "${sourcePath}\\scripts\\launch.mjs" %*\r\nif errorlevel 1 pause\r\nexit /b %errorlevel%\r\n`;
  const desktopLauncher = `@echo off\r\nchcp 65001 >nul\r\nsetlocal\r\nset "MUSIC_APP_CONFIG="\r\ncall "${sourcePath}\\一键启动.cmd" %*\r\nexit /b %errorlevel%\r\n`;
  const desktopRestart = `@echo off\r\nchcp 65001 >nul\r\nsetlocal\r\nset "MUSIC_APP_CONFIG="\r\nnode "${sourcePath}\\scripts\\desktop.mjs" --detach --restart %*\r\nset "SLOWTUNE_EXIT=%errorlevel%"\r\nif not "%SLOWTUNE_EXIT%"=="0" pause\r\nexit /b %SLOWTUNE_EXIT%\r\n`;
  const entries = { '一键启动.cmd': serviceLauncher, '桌面启动.cmd': desktopLauncher, '重建并启动桌面.cmd': desktopRestart };
  const alias = entry => `@echo off\r\ncall "%~dp0${entry}" %*\r\nexit /b %errorlevel%\r\n`;
  const legacy = {
    'start.cmd': [launcher('一键启动.cmd'), launcher('start.cmd'), serviceLauncher],
    '一键启动.cmd': [alias('start.cmd'), launcher('一键启动.cmd'), serviceLauncher],
    '桌面启动.cmd': [alias('一键启动.cmd'), desktopLauncher],
    '重建并启动桌面.cmd': [desktopRestart],
    '服务启动.cmd': [launcher('服务启动.cmd')],
    'update.cmd': [launcher('update.cmd')],
    '一键更新.cmd': [alias('update.cmd')],
    'stop.cmd': [launcher('stop.cmd'), launcher('stop.cmd').replace('chcp 65001 >nul\r\n', '')],
    'diagnose.cmd': [`@echo off\r\nchcp 65001 >nul\r\nsetlocal\r\nset "MUSIC_APP_CONFIG=%~dp0${configName}"\r\nnode "${sourcePath}\\scripts\\control.mjs" diagnose\r\nexit /b %errorlevel%\r\n`],
  };
  const normalize = text => text.replaceAll('\r\n', '\n').trimEnd();
  const existing = [];
  for (const [name, versions] of Object.entries(legacy)) {
    const file = join(instance, name);
    if (!existsSync(file)) continue;
    const current = normalize(readFileSync(file, 'utf8'));
    requireCondition(versions.some(content => current === normalize(content)), `实例入口已有自定义内容，请先核对：${file}`);
    if (!Object.hasOwn(entries, name) || current !== normalize(entries[name])) existing.push(name);
  }
  if (existing.length) {
    const backup = join(instance, '.launcher-backup', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
    mkdirSync(backup, { recursive: true });
    for (const name of existing) cpSync(join(instance, name), join(backup, name), { errorOnExist: true });
    for (const name of existing.filter(name => !Object.hasOwn(entries, name))) unlinkSync(join(instance, name));
  }
  for (const [name, content] of Object.entries(entries)) writeFileSync(join(instance, name), content);
}

export async function updateInstance({ noOpen = false } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  requireCondition(major > 24 || major === 24 && minor >= 15, '需要 Node 24.15 或更新的兼容版本。');
  const configFile = resolveConfigFile(), instance = realpathSync(dirname(configFile));
  // A whole instance can be copied without copying the source, dependencies or backup into itself.
  const updates = join(root, 'local', 'updates');
  requireCondition(instance !== realpathSync(root) && !inside(instance, realpathSync(root)), '一键更新需要独立实例目录，不能将配置与源码混放。');
  for (const file of ['package.json', 'package-lock.json', 'dist/server/config.js', 'dist/server/index.js', 'dist/client/index.html', 'node_modules/typescript/bin/tsc', 'node_modules/vite/bin/vite.js']) requireCondition(existsSync(join(root, file)), `更新所需文件不存在：${file}。请先准备源码工作区及开发依赖。`);
  requireCondition(!lstatSync(join(root, 'dist')).isSymbolicLink(), 'dist 不能是指向其他目录的链接。');
  requireCondition(typeof readJSON(join(root, 'package.json')).scripts?.build === 'string', '源码工作区没有 build 命令。');
  const originalConfig = process.env.MUSIC_APP_CONFIG;
  process.env.MUSIC_APP_CONFIG = configFile;
  let config;
  try { config = (await import(pathToFileURL(join(root, 'dist/server/config.js')).href)).readConfig(); }
  finally { if (originalConfig === undefined) delete process.env.MUSIC_APP_CONFIG; else process.env.MUSIC_APP_CONFIG = originalConfig; }
  for (const path of [config.database, config.runtimeDirectory]) requireCondition(inside(instance, path), '数据库和运行目录必须位于该独立实例目录内，才能完整备份。');
  inventory(instance); // Reject junctions before stopping a running instance.
  const host = config.host === '::1' ? '::1' : '127.0.0.1';
  const urlHost = host === '::1' ? config.allowedHosts.includes('::1') ? '[::1]' : 'localhost' : host;
  const base = `http://${urlHost}:${config.port}`;
  requireCondition(config.allowedHosts.includes(host) || host === '::1' && config.allowedHosts.includes('localhost'), 'allowedHosts 需要允许本机更新检查。');
  mkdirSync(updates, { recursive: true });
  const lock = join(root, 'local', 'update.lock'), token = randomUUID();
  if (existsSync(lock)) { const previous = readJSON(lock); requireCondition(Number.isInteger(previous.pid) && previous.pid > 0 && !alive(previous.pid), '已有更新正在进行，请等待它完成。'); unlinkSync(lock); }
  const fd = openSync(lock, 'wx');
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); } finally { closeSync(fd); }
  const env = { ...process.env, MUSIC_APP_CONFIG: configFile, MUSIC_APP_UPDATE_TOKEN: token };
  const stateFile = join(config.runtimeDirectory, 'service.json');
  const report = { configFile, instance, startedAt: new Date().toISOString(), status: 'running' };
  const save = () => { writeFileSync(join(updates, 'last-update.json'), JSON.stringify(report, null, 2) + '\n'); if (report.backup) writeFileSync(join(report.backup, 'update.json'), JSON.stringify(report, null, 2) + '\n'); };
  const phase = message => { console.log(message); report.phase = message; save(); };
  const start = async () => {
    const output = await run(process.execPath, [join(root, 'scripts/launch.mjs'), '--no-open'], env, true);
    return JSON.parse(output.split(/\r?\n/u).filter(line => line.startsWith('{')).at(-1));
  };
  let buildStarted = false, buildComplete = false, wasRunning = false;
  try {
    const launching = join(config.runtimeDirectory, 'launch.lock');
    if (existsSync(launching)) { const value = readJSON(launching); requireCondition(Number.isInteger(value.pid) && !alive(value.pid), '实例正在启动，请稍后更新。'); }
    installInstanceLauncher(instance, root, basename(configFile));
    phase('1/5 正在有序停止实例…');
    const state = existsSync(stateFile) ? readJSON(stateFile) : null;
    const busy = await portBusy(host, config.port);
    if (state && Number.isInteger(state.pid) && state.pid > 0 && alive(state.pid)) {
      requireCondition(state.port === config.port && typeof state.key === 'string' && busy, '实例状态与端口不一致，未开始更新。');
      const headers = { 'X-Control-Key': state.key };
      requireCondition((await fetch(base + '/internal/diagnose', { headers, signal: AbortSignal.timeout(5000) })).ok, '无法确认实例身份，未开始更新。');
      requireCondition((await fetch(base + '/internal/stop', { method: 'POST', headers, signal: AbortSignal.timeout(15000) })).ok, '实例拒绝有序停止，未开始更新。');
      wasRunning = true;
      const deadline = Date.now() + 30000;
      while (alive(state.pid) && Date.now() < deadline) await sleep(200);
      requireCondition(!alive(state.pid), '实例进程尚未退出，未开始备份或构建。');
    } else requireCondition(!busy, '端口被无法确认归属的服务占用，未开始更新。');
    requireCondition(!await portBusy(host, config.port), '实例端口仍在使用，未开始备份或构建。');
    phase('2/5 正在备份实例和旧构建，并核对数据库…');
    const backup = join(updates, 'backup-' + new Date().toISOString().replace(/[:.]/gu, '-') + '-' + randomUUID().slice(0, 8));
    requireCondition(inside(updates, backup) && !inside(instance, backup), '备份目标路径无效。');
    mkdirSync(backup); report.backup = backup;
    report.instanceFiles = copyVerified(instance, join(backup, 'instance'));
    report.buildFiles = copyVerified(join(root, 'dist'), join(backup, 'dist'));
    mkdirSync(join(backup, 'package'));
    for (const name of ['package.json', 'package-lock.json']) cpSync(join(root, name), join(backup, 'package', name), { force: false, errorOnExist: true });
    report.databases = checkDatabases(instance, join(backup, 'instance'));
    report.backupComplete = true; save();
    phase('3/5 正在构建最新源码…'); buildStarted = true;
    if (process.platform === 'win32') await run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm run build'], env);
    else await run('npm', ['run', 'build'], env);
    buildComplete = true;
    phase('4/5 正在启动更新后的实例…');
    const running = await start(); report.pid = running.pid;
    phase('5/5 正在核对服务和网页构建…');
    const current = readJSON(stateFile);
    const response = await fetch(base + '/internal/diagnose', { headers: { 'X-Control-Key': current.key }, signal: AbortSignal.timeout(10000) });
    requireCondition(response.ok, '更新后的服务诊断失败。');
    const diagnostic = await response.json();
    requireCondition(current.pid === running.pid && diagnostic.build?.stale === false && diagnostic.sources?.disposed === false && diagnostic.delivery?.disposed === false, '更新后的服务与构建状态不一致。');
    const page = await fetch(base, { signal: AbortSignal.timeout(10000) });
    requireCondition(page.ok && await page.text() === readFileSync(join(root, 'dist/client/index.html'), 'utf8'), '更新后的网页与当前构建不一致。');
    report.status = 'complete'; report.completedAt = new Date().toISOString(); report.url = base; save();
    console.log(`更新完成。请刷新已打开的网页。\n实例地址：${base}\n备份位置：${report.backup}`);
    if (!noOpen && process.platform === 'win32') try { await openBrowser(base); } catch (error) { console.error(error.message); }
    return report;
  } catch (error) {
    report.status = 'failed'; report.error = error.message;
    if (buildStarted && !buildComplete && report.backupComplete) {
      console.error('构建失败，正在恢复旧构建…');
      try {
        const target = resolve(root, 'dist');
        requireCondition(inside(realpathSync(root), target) && (!existsSync(target) || !lstatSync(target).isSymbolicLink() && realpathSync(target) === target), '旧构建恢复路径校验失败。');
        if (existsSync(target)) rmSync(target, { recursive: true, force: true });
        cpSync(join(report.backup, 'dist'), target, { recursive: true });
        report.buildRestored = true;
        if (wasRunning) { report.pid = (await start()).pid; report.previousServiceRestarted = true; }
      } catch (recovery) { report.recoveryError = recovery.message; }
    }
    save();
    throw new Error(`${error.message}${report.backup ? '\n备份位置：' + report.backup : ''}${report.previousServiceRestarted ? '\n已恢复旧构建并重新启动原实例。' : ''}${report.recoveryError ? '\n恢复失败：' + report.recoveryError : ''}`);
  } finally { if (existsSync(lock) && readJSON(lock).token === token) unlinkSync(lock); }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some(value => value !== '--no-open')) { console.error('仅支持 --no-open（更新但不打开浏览器）。'); process.exitCode = 1; }
  else updateInstance({ noOpen: args.includes('--no-open') }).catch(error => { console.error('慢听更新失败：' + error.message); process.exitCode = 1; });
}
