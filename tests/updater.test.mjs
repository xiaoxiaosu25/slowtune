import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { installInstanceLauncher } from '../scripts/update.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
const output = join(project, 'local', 'updater-tests'); mkdirSync(output, { recursive: true });
const wait = ms => new Promise(done => setTimeout(done, ms));
const json = file => JSON.parse(readFileSync(file, 'utf8'));
function put(root, file, content) { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function command(executable, args, cwd, env) {
  const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', value => stdout += value); child.stderr.on('data', value => stderr += value);
  return { child, result: new Promise((done, reject) => { child.once('error', reject); child.once('close', code => done({ code, stdout, stderr })); }) };
}
async function freePort() { const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done)); const { port } = server.address(); await new Promise(done => server.close(done)); return port; }

async function fixture(t) {
  const parent = mkdtempSync(join(output, 'workspace with spaces-')), root = join(parent, 'source app'), instance = join(parent, 'daily instance');
  mkdirSync(join(root, 'scripts'), { recursive: true }); mkdirSync(instance);
  for (const file of ['update.mjs', 'launch.mjs', 'start.mjs', 'instance-path.mjs']) copyFileSync(join(project, 'scripts', file), join(root, 'scripts', file));
  symlinkSync(join(project, 'node_modules'), join(root, 'node_modules'), 'junction');
  put(root, 'package.json', JSON.stringify({ type: 'module', version: 'fixture', scripts: { build: 'node build.mjs' } })); put(root, 'package-lock.json', '{}');
  put(root, 'dist/client/index.html', '<script type="module" src="/assets/index-old.js"></script>');
  copyFileSync(join(project, 'dist/server/config.js'), (mkdirSync(join(root, 'dist/server'), { recursive: true }), join(root, 'dist/server/config.js')));
  put(root, 'dist/server/index.js', `
import {createServer} from 'node:http';import{readFileSync,writeFileSync,mkdirSync,unlinkSync,statSync}from'node:fs';import{join,dirname}from'node:path';import{DatabaseSync}from'node:sqlite';import{readConfig,root}from'./config.js';
const c=readConfig();mkdirSync(c.runtimeDirectory,{recursive:true});mkdirSync(dirname(c.database),{recursive:true});
const db=new DatabaseSync(c.database);db.exec("CREATE TABLE IF NOT EXISTS saved(value TEXT);INSERT INTO saved SELECT 'keep me' WHERE NOT EXISTS(SELECT 1 FROM saved)");
const file=join(c.runtimeDirectory,'service.json'),key='test-control',capture=()=>({server:statSync(join(root,'dist/server/index.js')).mtimeMs,client:statSync(join(root,'dist/client/index.html')).mtimeMs}),before=capture();
const server=createServer((req,res)=>{if(req.url.startsWith('/internal/')&&req.headers['x-control-key']!==key){res.writeHead(403);return res.end();}if(req.url==='/internal/diagnose'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({sources:{disposed:false},delivery:{disposed:false},build:{stale:JSON.stringify(before)!==JSON.stringify(capture())}}));}if(req.url==='/internal/stop'){res.end('{}');db.close();server.close(()=>{unlinkSync(file);process.exit(0);});return;}res.end(readFileSync(join(root,'dist/client/index.html')));});
server.listen(c.port,c.host,()=>writeFileSync(file,JSON.stringify({pid:process.pid,port:c.port,key})));
`);
  put(root, 'build.mjs', `import{writeFileSync}from'node:fs';writeFileSync('build-ran','yes');if(process.env.UPDATE_TEST_DELAY)await new Promise(r=>setTimeout(r,1500));if(process.env.UPDATE_TEST_FAIL){writeFileSync('dist/client/index.html','partial failed build');throw new Error('injected build failure');}writeFileSync('dist/client/index.html','<script type="module" src="/assets/index-new.js"></script>');if(process.env.UPDATE_TEST_START_FAIL)writeFileSync('dist/server/index.js',"throw new Error('injected startup failure');");`);
  const config = { host: '127.0.0.1', port: await freePort(), allowedHosts: ['127.0.0.1'], accessKey: 'update-test-secret', userSpace: 'test', database: './data/library.sqlite', runtimeDirectory: './runtime' };
  const file = join(instance, 'config.local.json'); writeFileSync(file, JSON.stringify(config));
  mkdirSync(join(instance, 'data')); put(instance, 'runtime/credential.fixture', 'private credential'); put(instance, 'other-asset.fixture', 'keep this too');
  installInstanceLauncher(instance, root);
  const env = { MUSIC_APP_CONFIG: file }, state = () => json(join(instance, 'runtime/service.json'));
  const run = (script, more = {}) => command(process.execPath, [join(root, 'scripts', script + '.mjs'), '--no-open'], parent, { ...env, ...more });
  async function stop() {
    if (!existsSync(join(instance, 'runtime/service.json'))) return;
    const s = state();
    try { await fetch('http://127.0.0.1:' + config.port + '/internal/stop', { method: 'POST', headers: { 'X-Control-Key': s.key }, signal: AbortSignal.timeout(3000) }); } catch {}
    for (let i = 0; i < 100; i++) { try { process.kill(s.pid, 0); } catch { return; } await wait(50); }
    assert.fail('fixture service did not stop');
  }
  t.after(stop);
  return { parent, root, instance, config, file, env, state, run, report: () => json(join(root, 'local/updates/last-update.json')) };
}

test('cross-drive desktop entry calls the absolute source path', { skip: process.platform !== 'win32' }, () => {
  const instance = mkdtempSync(join(output, 'cross-drive-'));
  const drive = parse(instance).root[0].toUpperCase() === 'C' ? 'D' : 'C';
  const source = drive + ':\\source app';
  installInstanceLauncher(instance, source, 'custom config.json');
  const command = readFileSync(join(instance, '桌面启动.cmd'), 'utf8');
  assert(command.includes(`call "${source}\\一键启动.cmd" %*`));
  assert(command.includes('set "MUSIC_APP_CONFIG="'));
  const service = readFileSync(join(instance, '一键启动.cmd'), 'utf8');
  assert(service.includes(`node "${source}\\scripts\\launch.mjs" %*`));
  assert(service.includes('set "MUSIC_APP_CONFIG=%~dp0custom config.json"'));
  assert(readFileSync(join(instance, '重建并启动桌面.cmd'), 'utf8').includes(`node "${source}\\scripts\\desktop.mjs" --detach --restart %*`));
  installInstanceLauncher(instance, source, 'custom config.json');
});

test('maintenance update from an unrelated cwd backs up the complete instance and preserves data', { timeout: 60000 }, async t => {
  const f = await fixture(t), initial = await f.run('launch').result; assert.equal(initial.code, 0, initial.stderr); const old = f.state().pid;
  const result = await f.run('update').result;
  assert.equal(result.code, 0, result.stderr); assert.notEqual(f.state().pid, old);
  const report = f.report(); assert.equal(report.status, 'complete'); assert.equal(report.backupComplete, true); assert.equal(report.databases.length, 1);
  assert.equal(readFileSync(join(f.root, 'dist/client/index.html'), 'utf8').includes('index-new'), true);
  assert.equal(readFileSync(join(report.backup, 'dist/client/index.html'), 'utf8').includes('index-old'), true);
  for (const file of ['config.local.json', 'runtime/credential.fixture', 'other-asset.fixture']) assert.deepEqual(readFileSync(join(f.instance, file)), readFileSync(join(report.backup, 'instance', file)));
  const db = new DatabaseSync(join(f.instance, 'data/library.sqlite'), { readOnly: true }); try { assert.deepEqual(db.prepare('SELECT value FROM saved').all().map(row => row.value), ['keep me']); } finally { db.close(); }
  assert.equal(existsSync(join(f.root, 'local/update.lock')), false);
});

test('a failed build restores the old build and restarts the previous service without restoring databases', { timeout: 60000 }, async t => {
  const f = await fixture(t); assert.equal((await f.run('launch').result).code, 0);
  const result = await f.run('update', { UPDATE_TEST_FAIL: '1' }).result;
  assert.equal(result.code, 1); const report = f.report(); assert.equal(report.backupComplete, true); assert.equal(report.buildRestored, true); assert.equal(report.previousServiceRestarted, true);
  assert.equal(readFileSync(join(f.root, 'dist/client/index.html'), 'utf8').includes('index-old'), true);
  assert.equal((await fetch('http://127.0.0.1:' + f.config.port)).status, 200);
});

test('backup validation failure never starts a build or overwrites the old build', { timeout: 60000 }, async t => {
  const f = await fixture(t); assert.equal((await f.run('launch').result).code, 0);
  put(f.instance, 'data/broken.sqlite', 'not a database');
  const result = await f.run('update').result; assert.equal(result.code, 1);
  assert.equal(existsSync(join(f.root, 'build-ran')), false); assert.equal(f.report().backupComplete, undefined);
  assert.equal(readFileSync(join(f.root, 'dist/client/index.html'), 'utf8').includes('index-old'), true);
});

test('a new service startup failure reports failure and preserves the backup and live database', { timeout: 60000 }, async t => {
  const f = await fixture(t); assert.equal((await f.run('launch').result).code, 0);
  const result = await f.run('update', { UPDATE_TEST_START_FAIL: '1' }).result;
  assert.equal(result.code, 1); const report = f.report(); assert.equal(report.status, 'failed'); assert.equal(report.backupComplete, true); assert.equal(report.buildRestored, undefined);
  assert.equal(readFileSync(join(report.backup, 'dist/client/index.html'), 'utf8').includes('index-old'), true);
  const db = new DatabaseSync(join(f.instance, 'data/library.sqlite'), { readOnly: true }); try { assert.equal(db.prepare('SELECT value FROM saved').get().value, 'keep me'); } finally { db.close(); }
});

test('concurrent updates and ordinary launch cannot race an update; stale locks can be recovered', { timeout: 60000 }, async t => {
  const f = await fixture(t); put(f.root, 'local/update.lock', JSON.stringify({ pid: 99999999, token: 'abandoned' }));
  const first = f.run('update', { UPDATE_TEST_DELAY: '1' });
  for (let i = 0; i < 200 && !existsSync(join(f.root, 'build-ran')); i++) await wait(25);
  assert.equal(existsSync(join(f.root, 'build-ran')), true);
  const [second, launch] = await Promise.all([f.run('update').result, f.run('launch').result]);
  assert.equal(second.code, 1); assert.match(second.stderr, /已有更新正在进行/); assert.equal(launch.code, 1); assert.match(launch.stderr, /正在更新构建/);
  const result = await first.result; assert.equal(result.code, 0, result.stderr); assert.equal(f.report().status, 'complete');
});

test('an unrelated occupied port is never stopped and does not begin backup or build', { timeout: 60000 }, async t => {
  const f = await fixture(t), server = createServer(socket => socket.end()); await new Promise(done => server.listen(f.config.port, '127.0.0.1', done)); t.after(() => new Promise(done => server.close(done)));
  const result = await f.run('update').result; assert.equal(result.code, 1); assert.match(result.stderr, /无法确认归属/);
  assert.equal(existsSync(join(f.root, 'build-ran')), false); assert.equal(f.report().backup, undefined);
});
