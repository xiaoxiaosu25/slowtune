import { existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const read = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const validPid = pid => Number.isInteger(pid) && pid > 0;
const alive = pid => { if (!validPid(pid)) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitForStartup(stateFile, pid) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (!alive(pid)) return null;
    const state = read(stateFile);
    if (state?.pid === pid) return state;
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error('所选服务尚未完成启动，未强制结束进程；请稍后重试退出。');
}
const markerFor = (identity, state) => ({ identity, pid: state.pid, keyHash: hash(state.key) });
async function stopAuthenticated(base, state) {
  if (!Number.isInteger(state.pid) || state.pid <= 0 || typeof state.key !== 'string') throw new Error('服务状态无效，未发送停止请求。');
  const request = () => ({ headers: { 'X-Control-Key': state.key }, signal: AbortSignal.timeout(5000) });
  let controlUnavailable = false;
  try {
    const check = await fetch(base + '/internal/diagnose', request());
    if (!check.ok) throw new Error('服务控制身份校验失败，未发送停止请求。');
    const response = await fetch(base + '/internal/stop', { method: 'POST', ...request() });
    if (!response.ok) throw new Error('所选服务拒绝停止，请检查运行日志。');
  } catch (error) {
    // An earlier close can stop listening before cleanup has finished. Wait for
    // that selected process; do not turn a normal shutdown race into fetch failed.
    if (!['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'].includes(error.cause?.code)) throw error;
    controlUnavailable = true;
  }
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (!alive(state.pid)) return;
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(controlUnavailable ? '服务控制连接已中断，但所选进程尚未退出；请检查运行日志。' : '所选服务尚未退出，未强制结束进程；请检查运行日志。');
}
export function instanceIdentity(file, root, config) {
  return hash(JSON.stringify([realpathSync(file), realpathSync(root), config.host, config.port, config.allowedHosts, config.userSpace, config.database, config.runtimeDirectory]));
}
export function matchesInstance(marker, state, identity) {
  return !!state && !!marker && marker.identity === identity && marker.pid === state.pid && marker.keyHash === hash(state.key ?? '') && Number.isInteger(state.pid) && state.pid > 0;
}
export const desktopServiceHost = config => config.host === '::1' ? 'localhost' : config.allowedHosts.includes('127.0.0.1') ? '127.0.0.1' : 'localhost';
export async function ensureService(root, configFile, { local = false } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || major === 24 && minor < 15) throw new Error('本机服务需要 Node 24.15 或更新的兼容运行时。');
  await import('node:sqlite');
  process.env.MUSIC_APP_CONFIG = resolve(configFile);
  if (!existsSync(configFile)) throw new Error('所选服务配置不存在，请重新选择。');
  const { readConfig } = await import(pathToFileURL(join(root, 'dist/server/config.js')).href);
  const config = readConfig(), identity = instanceIdentity(configFile, root, config);
  if (local && config.host !== '127.0.0.1') throw new Error('桌面内部连接必须仅限本机。');
  const stateFile = join(config.runtimeDirectory, 'service.json'), markerFile = join(config.runtimeDirectory, 'desktop-service.json');
  const host = desktopServiceHost(config);
  if (!config.allowedHosts.includes(host)) throw new Error('所选配置的 allowedHosts 需包含可用的本机地址。');
  const base = `http://${host}:${config.port}`;
  let original = read(stateFile), marker = read(markerFile);
  if (marker?.starting === true && alive(marker.pid)) {
    if (marker.identity !== identity) throw new Error('此运行目录正被其他配置使用，请为所选配置指定独立的运行目录。');
    original = await waitForStartup(stateFile, marker.pid);
    if (original) {
      if (original.port !== config.port || typeof original.key !== 'string') throw new Error('服务启动结果与预期实例不一致，未加载窗口。');
      marker = markerFor(identity, original);
      writeFileSync(markerFile, JSON.stringify(marker), { mode: 0o600 });
    }
  }
  if (original && alive(original.pid) && !matchesInstance(marker, original, identity)) {
    if (local) throw new Error('桌面运行目录正被其他实例使用，未接管或关闭该实例。');
    if (original.port !== config.port || marker && marker.pid === original.pid) throw new Error('此运行目录正被其他配置使用，请为所选配置指定独立的运行目录。');
    // Older launchers have no desktop marker. Authenticate through the selected
    // instance's private control state, then restart it under the desktop build.
    await stopAuthenticated(base, original);
  }
  const result = await run(process.execPath, [join(root, 'scripts/launch.mjs'), '--no-open', '--desktop-owner=' + identity], {
    cwd: root, windowsHide: true, timeout: 75000, maxBuffer: 131072, env: { ...process.env, MUSIC_APP_CONFIG: resolve(configFile) },
  }).catch(error => { throw new Error(error.stderr?.trim() || '服务未能就绪，请检查配置和运行日志。'); });
  let launched;
  try { launched = result.stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line)).at(-1); } catch { /* report a bounded error */ }
  const state = read(stateFile);
  if (!launched || !state || launched.pid !== state.pid || state.port !== config.port || !alive(state.pid)) throw new Error('服务启动结果与预期实例不一致，未加载窗口。');
  if (['started', 'restarted'].includes(launched.action)) writeFileSync(markerFile, JSON.stringify(markerFor(identity, state)), { mode: 0o600 });
  if (!matchesInstance(read(markerFile), state, identity)) throw new Error('运行中的服务不属于所选桌面配置，未加载窗口。');
  const response = await fetch(base + '/internal/diagnose', { headers: { 'X-Control-Key': state.key }, signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('目标服务未通过控制身份校验。');
  const detail = await response.json();
  if (detail.sources?.disposed !== false || detail.delivery?.disposed !== false || detail.build?.stale !== false) throw new Error('目标服务尚未就绪，请检查运行日志后重试。');
  const page = await fetch(base, { signal: AbortSignal.timeout(3000) });
  if (!page.ok || !(await page.text()).includes('assets/index-')) throw new Error('目标服务的网页构建不可用。');
  // Do not return the control key or credentials to Electron or a renderer.
  return { url: base, action: launched.action, configFile: resolve(configFile), pid: state.pid };
}

export async function createDesktopSession(root, configFile, expectedPid) {
  process.env.MUSIC_APP_CONFIG = resolve(configFile);
  const { readConfig } = await import(pathToFileURL(join(root, 'dist/server/config.js')).href);
  const config = readConfig(), identity = instanceIdentity(configFile, root, config);
  const state = read(join(config.runtimeDirectory, 'service.json')), marker = read(join(config.runtimeDirectory, 'desktop-service.json'));
  if (!['127.0.0.1', '::1'].includes(config.host) || !validPid(expectedPid) || state?.pid !== expectedPid || !matchesInstance(marker, state, identity) || !alive(expectedPid)) throw new Error('本机音乐空间归属校验失败，请重新打开。');
  const host = desktopServiceHost(config);
  const url = `http://${host}:${config.port}`;
  const response = await fetch(url + '/internal/desktop-session', { method: 'POST', headers: { 'X-Control-Key': state.key }, redirect: 'error', signal: AbortSignal.timeout(5000) });
  const cookie = response.headers.get('set-cookie')?.match(/^music_session=([\w-]{43})(?:;|$)/)?.[1];
  if (!response.ok || !cookie) throw new Error('本机音乐空间暂时无法打开，请重试。');
  // Only the trusted desktop main process receives the HttpOnly session value.
  return { url, cookie };
}

export async function stopService(root, configFile, expectedPid, { optional = false } = {}) {
  process.env.MUSIC_APP_CONFIG = resolve(configFile);
  let config, identity;
  try {
    const { readConfig } = await import(pathToFileURL(join(root, 'dist/server/config.js')).href);
    config = readConfig(); identity = instanceIdentity(configFile, root, config);
  } catch (error) { if (optional) return { stopped: true }; throw error; }
  const stateFile = join(config.runtimeDirectory, 'service.json'), markerFile = join(config.runtimeDirectory, 'desktop-service.json');
  let state = read(stateFile), marker = read(markerFile);
  if (expectedPid !== undefined && !alive(expectedPid)) return { stopped: true };
  if (marker?.starting === true && marker.identity === identity && validPid(marker.pid) && (expectedPid === undefined || marker.pid === expectedPid)) {
    state = await waitForStartup(stateFile, marker.pid);
    if (!state) return { stopped: true };
    if (state.port !== config.port || typeof state.key !== 'string') throw new Error('服务归属无法确认，未发送停止请求。');
    marker = markerFor(identity, state);
    writeFileSync(markerFile, JSON.stringify(marker), { mode: 0o600 });
  }
  if (!state) return { stopped: true };
  if (expectedPid !== undefined && state.pid !== expectedPid) {
    if (!alive(expectedPid)) return { stopped: true };
    throw new Error('服务进程已变化，未停止替换后的服务。');
  }
  if (!validPid(state.pid)) { if (optional) return { stopped: true }; throw new Error('服务状态无效，未发送停止请求。'); }
  if (!alive(state.pid)) return { stopped: true };
  if (state.port !== config.port || !matchesInstance(marker, state, identity)) {
    if (optional) return { stopped: true };
    throw new Error('服务归属无法确认，未发送停止请求。');
  }
  const host = desktopServiceHost(config);
  try { await stopAuthenticated(`http://${host}:${config.port}`, state); }
  catch (error) { if (alive(state.pid)) throw error; }
  return { stopped: true };
}

// One-click source restart accepts the former in-repository desktop build and
// legacy services, always authenticating with the selected private state.
export async function stopServiceForRestart(root, configFile, sourceRoot) {
  process.env.MUSIC_APP_CONFIG = resolve(configFile);
  const { readConfig } = await import(pathToFileURL(join(root, 'dist/server/config.js')).href);
  const config = readConfig(), roots = [...new Set([root, sourceRoot, join(sourceRoot, 'local/desktop-build')])];
  const identities = roots.filter(existsSync).map(candidate => instanceIdentity(configFile, candidate, config));
  const stateFile = join(config.runtimeDirectory, 'service.json'), markerFile = join(config.runtimeDirectory, 'desktop-service.json');
  let state = read(stateFile), marker = read(markerFile);
  if (marker?.starting && alive(marker.pid)) {
    if (!identities.includes(marker.identity)) throw new Error('运行目录正被其他配置使用，未停止该服务。');
    state = await waitForStartup(stateFile, marker.pid);
    if (!state) return;
    marker = markerFor(marker.identity, state); writeFileSync(markerFile, JSON.stringify(marker), { mode: 0o600 });
  }
  if (!state || !alive(state.pid)) return;
  if (state.port !== config.port || marker?.pid === state.pid && !identities.some(identity => matchesInstance(marker, state, identity))) throw new Error('服务归属与所选配置不一致，未停止该服务。');
  const host = desktopServiceHost(config);
  await stopAuthenticated(`http://${host}:${config.port}`, state);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stopping = ['--stop', '--stop-if-owned'].includes(process.argv[4]);
  const action = process.argv[4] === '--session' ? createDesktopSession : stopping ? stopService : undefined;
  const task = action ? action(resolve(process.argv[2]), resolve(process.argv[3]), process.argv[5] ? Number(process.argv[5]) : undefined, { optional: process.argv[4] === '--stop-if-owned' }) : ensureService(resolve(process.argv[2]), resolve(process.argv[3]), { local: process.argv[4] === '--local' });
  task.then(value => process.stdout.write(JSON.stringify(value) + '\n')).catch(error => { console.error(error.message); process.exitCode = 1; });
}
