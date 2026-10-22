import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const readState = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
export const alive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
export const sleep = ms => new Promise(done => setTimeout(done, ms));
export function desktopDataDirectory(env = process.env, root = fileURLToPath(new URL('..', import.meta.url))) {
  if (env.MUSIC_APP_DESKTOP_DATA) return resolve(env.MUSIC_APP_DESKTOP_DATA);
  return join(root, 'data');
}
export const desktopRuntimeFile = data => join(data, 'desktop-runtime.json');
export async function desktopRequest(state, action) {
  if (!alive(state?.pid) || !Number.isInteger(state.port) || state.port < 1 || state.port > 65535 || typeof state.key !== 'string') throw new Error('桌面运行记录无效。');
  const response = await fetch(`http://127.0.0.1:${state.port}/${action}`, {
    method: ['stop', 'show'].includes(action) ? 'POST' : 'GET', headers: { 'X-Desktop-Key': state.key }, signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('桌面控制身份校验失败。');
  const detail = await response.json();
  if (detail.pid !== state.pid || detail.sourceRoot !== state.sourceRoot || detail.launchToken !== state.launchToken) throw new Error('桌面运行记录与当前进程不一致。');
  return detail;
}

// Source-only control channel; credentials never reach a renderer or terminal.
export async function serveDesktopLifecycle({ data, sourceRoot, launchToken = '', status, stop, show = () => {} }) {
  const file = desktopRuntimeFile(data), key = randomBytes(32).toString('hex');
  let record;
  const server = createServer((request, response) => {
    const accepted = request.headers['x-desktop-key'] === key;
    const stopping = request.url === '/stop' && request.method === 'POST';
    const showing = request.url === '/show' && request.method === 'POST';
    if (!accepted || !stopping && !showing && !(request.url === '/status' && request.method === 'GET')) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ pid: record.pid, sourceRoot, launchToken, ...status() }));
    if (stopping) setImmediate(stop);
    if (showing) setImmediate(show);
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  record = { pid: process.pid, port: server.address().port, key, sourceRoot, launchToken };
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file + '.tmp', JSON.stringify(record), { mode: 0o600 }); renameSync(file + '.tmp', file);
  } catch (error) { server.close(); throw error; }
  return () => {
    if (readState(file)?.key === key) { try { unlinkSync(file); } catch { /* already removed */ } }
    server.close(); server.closeAllConnections();
  };
}
