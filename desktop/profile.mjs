import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, lstatSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

export const localProfilePath = userData => join(userData, 'instance', 'config.local.json');

export function requiresLegacyProfileAdoption({ packaged, dataOverride, data, legacyData }) {
  return !packaged && !dataOverride && !existsSync(localProfilePath(data)) && existsSync(join(legacyData, 'desktop-state.json'));
}

export async function availablePort(port = 0) {
  const listener = createServer();
  try { await new Promise((done, reject) => { listener.once('error', reject); listener.listen(port, '127.0.0.1', done); }); }
  catch (error) { if (port && error.code === 'EADDRINUSE') return availablePort(); throw error; }
  const selected = listener.address().port;
  await new Promise((done, reject) => listener.close(error => error ? reject(error) : done()));
  return selected;
}

export async function ensureLocalProfile(userData) {
  const file = localProfilePath(userData);
  if (existsSync(file)) return file;
  const port = await availablePort();
  mkdirSync(join(userData, 'instance'), { recursive: true, mode: 0o700 });
  const config = { host: '127.0.0.1', port, allowedHosts: ['localhost', '127.0.0.1'], accessKey: randomBytes(32).toString('base64url'), userSpace: 'personal', database: '../library/library.sqlite', runtimeDirectory: '../runtime', logDirectory: '../logs', mediaLeaseTtlMs: 300000 };
  try { writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return file;
}

/** Desktop paths must remain owned by this application's data folder. */
export function validateLocalProfile(data, file = localProfilePath(data)) {
  if (resolve(file) !== resolve(localProfilePath(data))) throw new Error('桌面资料配置不属于此应用目录。');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  for (let current = resolve(file); ; current = dirname(current)) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('桌面资料目录不能通过链接指向其他实例。');
    if (!relative(resolve(data), current)) break;
  }
  if (config.host !== '127.0.0.1' || !Array.isArray(config.allowedHosts) || config.allowedHosts.some(host => !['localhost', '127.0.0.1'].includes(host))) throw new Error('桌面内部连接必须仅限本机。');
  for (const key of ['database', 'runtimeDirectory', 'logDirectory']) {
    if (key === 'logDirectory' && config[key] === undefined) continue;
    if (typeof config[key] !== 'string') throw new Error('桌面资料路径无效。');
    const part = relative(resolve(data), resolve(dirname(file), config[key]));
    if (!part || isAbsolute(part) || part === '..' || part.startsWith('..' + sep)) throw new Error('桌面资料路径超出应用 data 目录。');
    for (let current = resolve(dirname(file), config[key]); ; current = dirname(current)) {
      if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('桌面资料目录不能通过链接指向其他实例。');
      if (!relative(resolve(data), current)) break;
    }
  }
  return config;
}

export async function prepareLocalProfile(data) {
  const file = await ensureLocalProfile(data), config = validateLocalProfile(data, file);
  let running;
  try { running = JSON.parse(readFileSync(resolve(dirname(file), config.runtimeDirectory, 'service.json'), 'utf8')); } catch {}
  let alive = false;
  if (Number.isInteger(running?.pid) && running.pid > 0) { try { process.kill(running.pid, 0); alive = true; } catch {} }
  if (!alive) {
    const port = await availablePort(config.port);
    if (config.port !== port) { config.port = port; writeFileSync(file + '.tmp', JSON.stringify(config, null, 2) + '\n', { mode: 0o600 }); renameSync(file + '.tmp', file); }
  }
  return file;
}
