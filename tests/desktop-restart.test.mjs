import { test } from 'node:test';
import { desktopBuildDirectory, developmentPaths } from '../scripts/workspace-paths.mjs';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { restartDesktop, singleDesktopLaunch, stopDesktopForRestart } from '../scripts/desktop.mjs';
import { alive, sleep, readState, desktopRuntimeFile, desktopRequest, serveDesktopLifecycle } from '../desktop/lifecycle.mjs';
import electron from 'electron';

const root = resolve('.'), run = promisify(execFile), output = join(developmentPaths().testRuntime, 'desktop-startup-tests'); mkdirSync(output, { recursive: true });
async function until(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() >= deadline) throw new Error('restart fixture timed out'); await sleep(50); }
}

test('restart stops before building, never opens a failed build, and cleans a failed readiness check', async () => {
  const calls = [];
  const actions = Object.fromEntries(['stopDesktop', 'stopService', 'build', 'start', 'ready', 'cleanup'].map(action => [action, async () => { calls.push(action); } ]));
  await restartDesktop(actions);
  assert.deepEqual(calls, ['stopDesktop', 'stopService', 'build', 'start', 'ready']);
  for (const failed of ['stopDesktop', 'stopService', 'build', 'ready']) {
    calls.length = 0;
    await assert.rejects(restartDesktop({ ...actions, [failed]: async () => { calls.push(failed); throw new Error(failed); } }), new RegExp(failed));
    assert.deepEqual(calls, ['stopDesktop', 'stopService', 'build', 'start', 'ready'].slice(0, ['stopDesktop', 'stopService', 'build', 'start', 'ready'].indexOf(failed) + 1).concat(failed === 'ready' ? ['cleanup'] : []));
  }
});

test('concurrent clicks share one result, a different selection is rejected, and failures release the launch gate', { timeout: 15000 }, async () => {
  const identity = mkdtempSync(join(output, 'gate-'));
  let entered, complete, runs = 0;
  const started = new Promise(done => { entered = done; }), barrier = new Promise(done => { complete = done; });
  const first = singleDesktopLaunch(identity, 'selected', async () => { runs++; entered(); await barrier; });
  await started;
  const follower = singleDesktopLaunch(identity, 'selected', async () => { runs++; });
  await assert.rejects(singleDesktopLaunch(identity, 'other', async () => { runs++; }), /另一个配置/);
  complete(); await Promise.all([first, follower]); assert.equal(runs, 1);
  let fail, secondEntered;
  const secondStarted = new Promise(done => { secondEntered = done; });
  const secondBarrier = new Promise((_, reject) => { fail = reject; });
  const failing = singleDesktopLaunch(identity, 'selected', async () => { secondEntered(); await secondBarrier; });
  await secondStarted;
  const duplicate = singleDesktopLaunch(identity, 'selected', async () => assert.fail('must coalesce'));
  const assertions = [assert.rejects(failing, /build failed/), assert.rejects(duplicate, /build failed/)];
  await sleep(100); fail(new Error('build failed')); await Promise.all(assertions);
  await singleDesktopLaunch(identity, 'selected', async () => { runs++; }); assert.equal(runs, 2);
});

test('desktop lifecycle authenticates status and stop without exposing its key', async () => {
  const data = mkdtempSync(join(output, 'control-')); let stopped = false;
  const close = await serveDesktopLifecycle({ data, sourceRoot: root, launchToken: 'fixture', status: () => ({ phase: 'ready' }), stop: () => { stopped = true; } });
  try {
    const state = readState(desktopRuntimeFile(data));
    const rejected = await fetch(`http://127.0.0.1:${state.port}/stop`, { method: 'POST' }); assert.equal(rejected.status, 403); assert.equal(stopped, false);
    await assert.rejects(desktopRequest({ ...state, key: 'wrong-key' }, 'stop'), /身份校验/); assert.equal(stopped, false);
    const detail = await desktopRequest(state, 'status'); assert.equal(detail.phase, 'ready'); assert.equal(detail.key, undefined);
    await desktopRequest(state, 'stop'); await until(() => stopped);
  } finally { close(); }
  assert.equal(existsSync(desktopRuntimeFile(data)), false);
});

test('legacy desktop with a custom profile blocks restart before stopping services; default fallback closes its exact app', { timeout: 30000, skip: process.platform !== 'win32' }, async () => {
  const product = mkdtempSync(join(output, 'legacy app with spaces-')), data = join(product, 'profile'), ready = join(product, 'ready.json'), stopped = join(product, 'stopped.txt');
  mkdirSync(join(product, 'desktop'));
  writeFileSync(join(product, 'desktop/package.json'), '{"type":"module","main":"main.mjs"}');
  writeFileSync(join(product, 'desktop/main.mjs'), `import{app,BrowserWindow}from'electron';import{writeFileSync}from'node:fs';app.setPath('userData',process.env.MUSIC_APP_DESKTOP_DATA);app.on('before-quit',()=>writeFileSync(${JSON.stringify(stopped)},'graceful'));app.on('window-all-closed',()=>app.quit());void app.whenReady().then(async()=>{const window=new BrowserWindow({width:400,height:200});await window.loadURL('data:text/html,Legacy restart fixture');writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid}));});`);
  const env = { ...process.env, MUSIC_APP_DESKTOP_DATA: data }; delete env.NODE_OPTIONS; delete env.ELECTRON_RUN_AS_NODE;
  await stopDesktopForRestart({ root: product, data, electron, environment: env });
  const application = run(electron, [join(product, 'desktop')], { env, windowsHide: true, timeout: 25000 }); application.catch(() => {});
  await Promise.race([until(() => existsSync(ready)), application.then(() => { throw new Error('legacy fixture exited before creating its window'); })]);
  try {
    const calls = [];
    await assert.rejects(restartDesktop({
      stopDesktop: async () => { calls.push('desktop'); await stopDesktopForRestart({ root: product, data, electron, environment: env }); },
      ...Object.fromEntries(['stopService', 'build', 'start', 'ready'].map(action => [action, async () => { calls.push(action); }])),
    }), error => { assert.match(error.stderr, /无法确认其是否使用所选自定义资料目录/); return true; });
    assert.deepEqual(calls, ['desktop']); assert(alive(readState(ready).pid)); assert.equal(existsSync(stopped), false);
  } finally {
    await stopDesktopForRestart({ root: product, data, electron, environment: { ...env, MUSIC_APP_DESKTOP_DATA: '' } });
    await application;
  }
  assert.equal(readFileSync(stopped, 'utf8'), 'graceful'); assert.equal(alive(readState(ready).pid), false);
});

test('ordinary opening reuses the desktop; explicit restart rebuilds and stops only its own processes', { timeout: 120000, skip: process.platform !== 'win32' }, async t => {
  const directory = mkdtempSync(join(output, 'restart with spaces-')), product = join(directory, 'source'), data = join(directory, 'profile');
  mkdirSync(join(product, 'scripts'), { recursive: true });
  writeFileSync(join(product, 'workspace.paths.json'), JSON.stringify({ schemaVersion: 1, project: 'slowtune', paths: { studio: '..', build: '../local/build/slowtune', artifacts: '../local/artifacts/slowtune', testRuntime: '../local/runtime/slowtune' } }));
  cpSync(join(root, 'desktop'), join(product, 'desktop'), { recursive: true });
  for (const name of ['desktop.mjs', 'workspace-paths.mjs', 'instance-path.mjs', 'start.mjs', 'launch.mjs']) cpSync(join(root, 'scripts', name), join(product, 'scripts', name));
  symlinkSync(join(root, 'node_modules'), join(product, 'node_modules'), 'junction');
  writeFileSync(join(product, 'package.json'), '{"type":"module"}');
  const configModule = readFileSync(join(resolve(process.env.MUSIC_APP_TEST_BUILD ?? desktopBuildDirectory()), 'dist/server/config.js'), 'utf8');
  const listener = createServer(); await new Promise(done => listener.listen(0, '127.0.0.1', done)); const port = listener.address().port; await new Promise(done => listener.close(done));
  mkdirSync(join(data, 'instance'), { recursive: true }); const file = join(data, 'instance/config.local.json');
  writeFileSync(file, JSON.stringify({ host: '127.0.0.1', port, allowedHosts: ['127.0.0.1'], accessKey: 'restart-fixture', userSpace: 'restart-fixture', database: '../library/library.sqlite', runtimeDirectory: '../runtime' }));
  const stateFile = join(data, 'runtime/service.json'), count = join(product, 'builds.txt'), versionFile = join(product, 'source-version.txt');
  const env = { ...process.env, MUSIC_APP_CONFIG: join(directory, 'unrelated-config.json'), MUSIC_APP_DESKTOP_DATA: data }; delete env.NODE_OPTIONS; delete env.ELECTRON_RUN_AS_NODE;
  const launch = (restart = true) => run(process.execPath, [join(product, 'scripts/desktop.mjs'), '--detach', ...(restart ? ['--restart'] : [])], { cwd: directory, env, windowsHide: true, timeout: 45000 });
  t.after(async () => { await stopDesktopForRestart({ root: product, data, electron, environment: env }); });
  const serverCode = `import{createServer}from'node:http';import{readFileSync,writeFileSync,mkdirSync,unlinkSync}from'node:fs';import{join}from'node:path';import{readConfig}from'./config.js';const config=readConfig(),key='fixture-'+process.pid,state=join(config.runtimeDirectory,'service.json'),version=readFileSync(new URL('./version.txt',import.meta.url),'utf8');mkdirSync(config.runtimeDirectory,{recursive:true});const server=createServer((request,response)=>{if(request.url.startsWith('/internal/')&&request.headers['x-control-key']!==key){response.writeHead(403).end();return;}if(request.url==='/internal/desktop-session'){response.setHeader('Set-Cookie','music_session='+'a'.repeat(43)+'; Path=/; HttpOnly');response.end('{}');return;}if(request.url==='/internal/stop'){response.end('{}');server.close(()=>{unlinkSync(state);process.exit(0);});return;}response.end(request.url==='/internal/diagnose'?JSON.stringify({sources:{disposed:false},delivery:{disposed:false},build:{stale:false},version}):'<html><body>assets/index-'+version+'<script>window.slowTuneDesktop.onCommand(command=>{if(command==="release")window.slowTuneDesktop.playbackReleased(true);});</script></body></html>');});server.listen(config.port,config.host,()=>writeFileSync(state,JSON.stringify({pid:process.pid,port:config.port,key})));`;
  writeFileSync(join(product, 'scripts/build-desktop.mjs'), `import{readFileSync,writeFileSync,appendFileSync,mkdirSync,cpSync,symlinkSync,existsSync}from'node:fs';import{join}from'node:path';import{fileURLToPath}from'node:url';const root=fileURLToPath(new URL('..',import.meta.url)),version=readFileSync(join(root,'source-version.txt'),'utf8');appendFileSync(join(root,'builds.txt'),version+'\\n');await new Promise(done=>setTimeout(done,800));if(version==='fail')throw new Error('fixture build failed');const {desktopBuildDirectory}=await import('./workspace-paths.mjs');const built=desktopBuildDirectory(root);for(const folder of['dist/client','dist/server','scripts'])mkdirSync(join(built,folder),{recursive:true});writeFileSync(join(built,'package.json'),'{"type":"module"}');writeFileSync(join(built,'dist/client/index.html'),'assets/index-'+version);writeFileSync(join(built,'dist/server/config.js'),${JSON.stringify(configModule)});writeFileSync(join(built,'dist/server/index.js'),${JSON.stringify(serverCode)});writeFileSync(join(built,'dist/server/version.txt'),version);for(const name of['launch.mjs','start.mjs','instance-path.mjs'])cpSync(join(root,'scripts',name),join(built,'scripts',name));if(!existsSync(join(built,'node_modules')))symlinkSync(join(root,'node_modules'),join(built,'node_modules'),'junction');`);
  writeFileSync(versionFile, '1');
  const first = launch(); await until(() => existsSync(count));
  const together = launch(); const results = await Promise.all([first, together]);
  assert(results.some(result => result.stdout.includes('同一次启动')));
  assert.equal(readFileSync(count, 'utf8'), '1\n');
  const oldDesktop = readState(desktopRuntimeFile(data)), oldService = readState(stateFile);
  assert(alive(oldDesktop.pid)); assert(alive(oldService.pid));
  writeFileSync(versionFile, '2'); await launch(false);
  assert.equal(readState(desktopRuntimeFile(data)).pid, oldDesktop.pid); assert.equal(readFileSync(count, 'utf8'), '1\n');
  await launch();
  const nextDesktop = readState(desktopRuntimeFile(data)), nextService = readState(stateFile);
  assert.notEqual(nextDesktop.pid, oldDesktop.pid); assert.notEqual(nextService.pid, oldService.pid);
  assert.equal(alive(oldDesktop.pid), false); assert.equal(alive(oldService.pid), false);
  const diagnosis = await fetch(`http://127.0.0.1:${port}/internal/diagnose`, { headers: { 'X-Control-Key': nextService.key } }).then(response => response.json());
  assert.equal(diagnosis.version, '2'); assert.equal(readFileSync(count, 'utf8'), '1\n2\n');
  writeFileSync(versionFile, 'fail'); await assert.rejects(launch(), /未启动旧版本/);
  assert.equal(alive(nextDesktop.pid), false); assert.equal(alive(nextService.pid), false);
  assert.equal(existsSync(desktopRuntimeFile(data)), false); assert.equal(existsSync(stateFile), false);
  writeFileSync(versionFile, '3'); await launch();
  assert.equal((await desktopRequest(readState(desktopRuntimeFile(data)), 'status')).phase, 'ready');
  assert.equal(readFileSync(count, 'utf8'), '1\n2\nfail\n3\n');
});
