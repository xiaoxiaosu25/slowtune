import { test } from 'node:test';
import { desktopBuildDirectory, developmentPaths } from '../scripts/workspace-paths.mjs';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { ensureService, stopService, stopServiceForRestart } from '../desktop/service.mjs';
import { desktopLaunchOptions } from '../scripts/desktop.mjs';

const root = resolve('.'), output = join(developmentPaths().testRuntime, 'desktop-tests'); mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(done => setTimeout(done, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const read = file => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
async function waitFor(check, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() >= deadline) throw new Error('isolated service did not reach the expected state'); await sleep(50); }
}

async function fixture(t, delay = 0, productPath = 'product') {
  const directory = mkdtempSync(join(output, 'failed-service-')), product = join(directory, productPath), runtime = join(directory, 'runtime');
  mkdirSync(join(product, 'dist/server'), { recursive: true }); mkdirSync(join(product, 'dist/client')); mkdirSync(join(product, 'scripts'));
  cpSync(join(resolve(process.env.MUSIC_APP_TEST_BUILD ?? desktopBuildDirectory()), 'dist/server/config.js'), join(product, 'dist/server/config.js'));
  for (const file of ['launch.mjs', 'start.mjs', 'instance-path.mjs']) cpSync(join(root, 'scripts', file), join(product, 'scripts', file));
  symlinkSync(join(root, 'node_modules'), join(product, 'node_modules'), 'junction');
  writeFileSync(join(product, 'package.json'), '{"type":"module"}'); writeFileSync(join(product, 'dist/client/index.html'), 'assets/index-fixture.js');
  const listener = createServer(); await new Promise(done => listener.listen(0, '127.0.0.1', done));
  const port = listener.address().port; await new Promise(done => listener.close(done));
  const file = join(directory, 'config.local.json'), pidFile = join(directory, 'spawned.json');
  const config = { host: '127.0.0.1', port, allowedHosts: ['localhost', '127.0.0.1'], accessKey: 'isolated-failure-fixture', userSpace: 'failure-test', database: join(directory, 'library.sqlite'), runtimeDirectory: runtime };
  writeFileSync(file, JSON.stringify(config));
  writeFileSync(join(product, 'dist/server/index.js'), `
import {createServer} from 'node:http';
import {existsSync,mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {readConfig} from './config.js';
const config=readConfig(),key='isolated-control-'+process.pid;
writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({pid:process.pid}));
await new Promise(done=>setTimeout(done,${delay}));
mkdirSync(config.runtimeDirectory,{recursive:true});
const stateFile=join(config.runtimeDirectory,'service.json');
const server=createServer((request,response)=>{
  if(request.url==='/fixture/close-listener'){
    response.end('{}');server.close();server.closeIdleConnections();
    setTimeout(()=>process.exit(0),1000);return;
  }
  if(request.url.startsWith('/internal/')&&request.headers['x-control-key']!==key){response.writeHead(403);response.end();return;}
  if(request.url==='/internal/stop'){
    if(existsSync(join(config.runtimeDirectory,'reject-stop'))){response.writeHead(403);response.end();return;}
    response.end('{}');server.close(()=>{unlinkSync(stateFile);process.exit(0);});return;
  }
  response.end(request.url==='/internal/diagnose'?JSON.stringify({sources:{disposed:false},delivery:{disposed:false},build:{stale:false}}):'assets/index-fixture.js');
});
server.listen(config.port,config.host,()=>writeFileSync(stateFile,JSON.stringify({pid:process.pid,port:config.port,key})));
`);
  const stateFile = join(runtime, 'service.json'), markerFile = join(runtime, 'desktop-service.json');
  t.after(async () => {
    const pid = read(pidFile)?.pid;
    if (!pid || !alive(pid)) return;
    const state = read(stateFile);
    if (state?.pid === pid) await fetch(`http://127.0.0.1:${port}/internal/stop`, { method: 'POST', headers: { 'X-Control-Key': state.key } }).catch(() => {});
    // Only this fixture's recorded child may be terminated if a failing test left it starting.
    if (alive(pid)) process.kill(pid, 'SIGKILL');
    await waitFor(() => !alive(pid));
  });
  return { directory, product, runtime, file, config, stateFile, markerFile, pidFile };
}

test('exited desktop service does not block shutdown or contact a replacement on its port', { timeout: 30000 }, async t => {
  const f = await fixture(t), service = await ensureService(f.product, f.file);
  const other = join(f.directory, 'other-config.json'); writeFileSync(other, JSON.stringify({ ...f.config, database: join(f.directory, 'other.sqlite') }));
  assert.deepEqual(await stopService(f.product, other, undefined, { optional: true }), { stopped: true });
  assert(alive(service.pid), 'optional cleanup leaves an unclaimed instance running');
  const rejectStop = join(f.runtime, 'reject-stop'); writeFileSync(rejectStop, 'fixture');
  await assert.rejects(stopService(f.product, f.file, undefined, { optional: true }), /所选服务拒绝停止/);
  assert(alive(service.pid), 'optional cleanup propagates errors for a claimed service'); unlinkSync(rejectStop);
  process.kill(service.pid, 'SIGKILL'); await waitFor(() => !alive(service.pid));
  assert(existsSync(f.stateFile), 'the crashed service leaves its state behind');
  let requests = 0;
  const unrelated = createServer((_request, response) => { requests++; response.writeHead(403); response.end(); });
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      await new Promise((done, reject) => {
        const failed = error => { unrelated.removeListener('listening', ready); reject(error); };
        const ready = () => { unrelated.removeListener('error', failed); done(); };
        unrelated.once('error', failed); unrelated.once('listening', ready); unrelated.listen(f.config.port, '127.0.0.1');
      });
      break;
    } catch (error) { if (error.code !== 'EADDRINUSE' || Date.now() >= deadline) throw error; await sleep(50); }
  }
  try {
    assert.deepEqual(await stopService(f.product, f.file, service.pid), { stopped: true });
    assert.deepEqual(await stopService(f.product, f.file), { stopped: true });
    assert.equal(requests, 0);
  } finally { await new Promise(done => unrelated.close(done)); }
});

test('a selected backend already closing its control port is awaited rather than rejected', { timeout: 15000 }, async t => {
  const f = await fixture(t), service = await ensureService(f.product, f.file);
  await fetch(`http://127.0.0.1:${f.config.port}/fixture/close-listener`);
  assert(alive(service.pid), 'cleanup is still running after the listener closes');
  assert.deepEqual(await stopService(f.product, f.file, service.pid), { stopped: true });
  assert.equal(alive(service.pid), false);
});

test('one-click restart authenticates the selected former build and legacy service, rejecting another config', { timeout: 30000 }, async t => {
  const f = await fixture(t), service = await ensureService(f.product, f.file);
  const other = join(f.directory, 'other-config.json'); writeFileSync(other, JSON.stringify({ ...f.config, database: join(f.directory, 'other.sqlite') }));
  await assert.rejects(stopServiceForRestart(f.product, other, f.directory), /归属与所选配置不一致/);
  assert(alive(service.pid));
  const alternate = join(f.directory, 'new-build'); mkdirSync(join(alternate, 'dist/server'), { recursive: true });
  cpSync(join(f.product, 'dist/server/config.js'), join(alternate, 'dist/server/config.js')); writeFileSync(join(alternate, 'package.json'), '{"type":"module"}');
  await stopServiceForRestart(alternate, f.file, f.product);
  assert.equal(alive(service.pid), false);
  const legacy = await ensureService(f.product, f.file); unlinkSync(f.markerFile);
  await stopServiceForRestart(f.product, f.file, f.directory);
  assert.equal(alive(legacy.pid), false);
});

test('external source build takes over an orphaned in-repository desktop service without claiming another config', { timeout: 30000 }, async t => {
  const f = await fixture(t, 0, 'source/local/desktop-build'), source = join(f.directory, 'source');
  writeFileSync(join(source, 'workspace.paths.json'), JSON.stringify({ schemaVersion: 1, project: 'slowtune', paths: { studio: '..', build: '../local/build/slowtune', artifacts: '../local/artifacts/slowtune', testRuntime: '../local/runtime/slowtune' } }));
  const built = desktopBuildDirectory(source);
  mkdirSync(join(built, 'dist/server'), { recursive: true }); mkdirSync(join(built, 'dist/client'));
  cpSync(join(f.product, 'dist/server/config.js'), join(built, 'dist/server/config.js'));
  writeFileSync(join(built, 'package.json'), '{"type":"module"}');
  writeFileSync(join(built, 'dist/server/index.js'), 'fixture'); writeFileSync(join(built, 'dist/client/index.html'), 'fixture');
  const service = await ensureService(f.product, f.file);
  const { serviceRoot } = desktopLaunchOptions(source, { MUSIC_APP_CONFIG: f.file });
  assert.equal(serviceRoot, built);
  const other = join(f.directory, 'other-config.json'); writeFileSync(other, JSON.stringify({ ...f.config, database: join(f.directory, 'other.sqlite') }));
  await assert.rejects(stopServiceForRestart(serviceRoot, other, source), /归属与所选配置不一致/);
  assert(alive(service.pid));
  await stopServiceForRestart(serviceRoot, f.file, source);
  assert.equal(alive(service.pid), false);
});

test('startup timeout retains ownership and optional desktop shutdown waits for and stops that child', { timeout: 60000 }, async t => {
  const f = await fixture(t, 34000);
  await assert.rejects(ensureService(f.product, f.file), /30 秒内未就绪/);
  const pending = read(f.markerFile);
  assert.equal(pending.starting, true); assert.equal(pending.pid, read(f.pidFile).pid); assert(alive(pending.pid));
  assert.equal(existsSync(f.stateFile), false, 'ownership is recorded before the service writes its ready state');
  const other = join(f.directory, 'other-config.json'); writeFileSync(other, JSON.stringify({ ...f.config, userSpace: 'another-instance' }));
  assert.deepEqual(await stopService(f.product, other, undefined, { optional: true }), { stopped: true });
  assert(alive(pending.pid), 'a different config cannot claim the pending process');
  assert.deepEqual(await stopService(f.product, f.file, undefined, { optional: true }), { stopped: true });
  assert.equal(alive(pending.pid), false); assert.equal(existsSync(f.stateFile), false);
});
