import { test } from 'node:test';
import { desktopBuildDirectory, developmentPaths } from '../scripts/workspace-paths.mjs';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { _electron } from 'playwright-core';
import electron from 'electron';
import { alive, closeDesktop } from './helpers/desktop-process.mjs';
import { markOwnedFixture } from './helpers/desktop-owned-fixture.mjs';

test('desktop reloads current HTML and assets from a persistent profile while retaining cookies and preferences', { timeout: 45000 }, async t => {
  const root = resolve('.'), output = join(developmentPaths().testRuntime, 'desktop-tests'); mkdirSync(output, { recursive: true });
  const directory = mkdtempSync(join(output, 'persistent-cache-')), product = join(directory, 'product'), data = join(directory, 'profile'), runtime = join(data, 'runtime');
  for (const folder of ['dist/server', 'dist/client', 'scripts']) mkdirSync(join(product, folder), { recursive: true });
  cpSync(join(resolve(process.env.MUSIC_APP_TEST_BUILD ?? desktopBuildDirectory()), 'dist/server/config.js'), join(product, 'dist/server/config.js'));
  writeFileSync(join(product, 'package.json'), '{"type":"module"}'); writeFileSync(join(product, 'dist/client/index.html'), 'assets/index-fixture.js');
  let version = 1, backend, application;
  const stateFile = join(runtime, 'service.json');
  const server = createServer((request, response) => {
    if (request.url.startsWith('/internal/')) {
      if (request.headers['x-control-key'] !== 'cache-fixture') { response.writeHead(403).end(); return; }
      if (request.url === '/internal/desktop-session') { response.setHeader('Set-Cookie', 'music_session=' + 'a'.repeat(43) + '; Path=/; HttpOnly'); response.end('{}'); return; }
      if (request.url === '/internal/stop') {
        if (existsSync(stateFile)) unlinkSync(stateFile); backend.send('stop'); response.end('{}'); return;
      }
      response.end(JSON.stringify({ sources: { disposed: false }, delivery: { disposed: false }, build: { stale: false } })); return;
    }
    response.setHeader('Cache-Control', 'public, max-age=86400');
    const script = request.url.match(/^\/assets\/index-(\d+)\.js$/);
    if (script) { response.setHeader('Content-Type', 'text/javascript'); response.end(`document.body.dataset.build='${script[1]}';document.body.append('cached-client-${script[1]}');window.slowTuneDesktop.onCommand(command=>{if(command==='release')window.slowTuneDesktop.playbackReleased(true);});`); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html><body><script src="/assets/index-${version}.js"></script></body></html>`);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  mkdirSync(join(data, 'instance'), { recursive: true });
  const port = server.address().port, file = join(data, 'instance/config.local.json'), base = `http://127.0.0.1:${port}/`;
  const config = { host: '127.0.0.1', port, allowedHosts: ['127.0.0.1'], accessKey: 'desktop-cache-fixture', userSpace: 'cache-fixture', database: join(data, 'library.sqlite'), runtimeDirectory: runtime };
  writeFileSync(file, JSON.stringify(config));
  const env = { ...process.env, MUSIC_APP_CONFIG: file, MUSIC_APP_NODE: process.execPath, MUSIC_APP_DESKTOP_ROOT: product, MUSIC_APP_DESKTOP_DATA: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  t.after(async () => {
    try { if (application) await closeDesktop(application); }
    finally { if (backend && alive(backend.pid)) backend.kill(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
  });
  const launch = async () => {
    backend = spawn(process.execPath, ['-e', "process.on('message',()=>process.exit(0));setInterval(()=>{},1000)"], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    await new Promise((done, reject) => { backend.once('spawn', done); backend.once('error', reject); });
    markOwnedFixture(product, file, config, backend.pid, 'cache-fixture');
    writeFileSync(join(product, 'scripts/launch.mjs'), `import{mkdirSync,writeFileSync}from'node:fs';mkdirSync(${JSON.stringify(runtime)},{recursive:true});writeFileSync(${JSON.stringify(stateFile)},JSON.stringify({pid:${backend.pid},port:${port},key:'cache-fixture'}));console.log(JSON.stringify({action:'started',pid:${backend.pid}}));`);
    application = await _electron.launch({ executablePath: electron, args: [join(root, 'desktop')], env, timeout: 20000 });
    for (let n = 0; n < 200; n++) { const page = application.windows().find(page => page.url() === base); if (page) { await page.locator('body[data-build]').waitFor(); return page; } await new Promise(done => setTimeout(done, 50)); }
    throw new Error('cache fixture window not loaded');
  };
  const first = await launch(); assert.equal(await first.locator('body').getAttribute('data-build'), '1');
  await first.evaluate(() => { localStorage.setItem('desktop-cache-preference', 'keep'); document.cookie = 'desktop-cache-fixture=keep; Path=/; SameSite=Strict; Max-Age=86400'; });
  await closeDesktop(application); application = undefined;
  version = 2;
  const second = await launch();
  assert.equal(await second.locator('body').getAttribute('data-build'), '2', 'the new backend must not reuse the old cached HTML and script');
  assert.equal(await second.evaluate(() => localStorage.getItem('desktop-cache-preference')), 'keep');
  assert.match(await second.evaluate(() => document.cookie), /desktop-cache-fixture=keep/);
});
