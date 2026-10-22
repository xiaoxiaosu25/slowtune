import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright-core';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const project = fileURLToPath(new URL('..', import.meta.url)), root = process.env.MUSIC_APP_TEST_BUILD ?? project;
const load = name => import(pathToFileURL(join(root, 'dist/server', name + '.js')).href);
const { SongLibraryStore } = await load('song-library-store');
const { SongLibraryService } = await load('song-library-service');
const { emptySongLibrary } = await load('song-library-codec');
const { createSongLibraryRouter } = await load('song-library-http');

test('new backup panel reads files, previews and restores only the new format with explicit replacement consent', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'slowtune-song-panel-')), store = new SongLibraryStore(join(directory, 'songs.sqlite'), 'fixture'), service = new SongLibraryService(store);
  t.after(async () => { store.close(); assert(directory.startsWith(join(tmpdir(), 'slowtune-song-panel-'))); await rm(directory, { recursive: true, force: true }); });
  const artifacts = await build({ configFile: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' }, esbuild: { jsx: 'automatic' }, build: { write: false, minify: false, target: 'esnext', lib: { entry: join(project, 'tests/helpers/song-library-panel.tsx'), formats: ['es'] }, rollupOptions: { output: { inlineDynamicImports: true } } } });
  const output = (Array.isArray(artifacts) ? artifacts : [artifacts]).flatMap(a => a.output), script = output.find(a => a.type === 'chunk' && a.isEntry).code, css = output.filter(a => a.type === 'asset' && a.fileName.endsWith('.css')).map(a => a.source).join('\n');
  const app = new Hono(); app.route('/api/song-library', createSongLibraryRouter(service, c => c.req.header('Cookie') === 'session=fixture' ? 'browser' : ''));
  app.get('/fixture.js', c => c.body(script, 200, { 'Content-Type': 'text/javascript' })); app.get('/fixture.css', c => c.body(css, 200, { 'Content-Type': 'text/css' }));
  app.get('/', c => c.html('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'));
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = 'http://127.0.0.1:' + server.address().port, browser = await chromium.launch({ executablePath: process.env.MUSIC_APP_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  t.after(() => browser.close()); const context = await browser.newContext(); await context.addCookies([{ name: 'session', value: 'fixture', url: origin }]);
  const page = await context.newPage(), errors = [], external = []; page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  const initialized = Promise.race([page.waitForEvent('pageerror').then(error => { throw error; }), page.getByRole('button', { name: '校验并预览影响' }).waitFor()]);
  await page.goto(origin); await initialized;
  await page.locator('input[type=file]').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"studio-music-library","version":1,"playlists":[],"favorites":[]}') });
  await page.getByRole('alert').waitFor(); assert.match(await page.getByRole('alert').innerText(), /格式不正确/);
  const data = emptySongLibrary(); data.songs.push({ id: 'manual', title: '人工标准歌名', artists: ['人工歌手'], fields: { title: { source: 'manual', protected: true }, artists: { source: 'manual', protected: true } }, contentKind: 'single', originals: [{ title: '榜单原名' }], aliases: [], defaultVersionId: null, organization: 'organized', createdAt: 1, updatedAt: 1 }); data.favorites.push({ favoriteId: 'fav', songId: 'manual', position: 0, addedAt: 1 });
  await page.locator('input[type=file]').setInputFiles({ name: 'new.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await page.getByRole('combobox').selectOption('replace'); await page.getByRole('button', { name: '校验并预览影响' }).click();
  const commit = page.getByRole('button', { name: '确认导入', exact: true }); await commit.waitFor(); assert.equal(await commit.isDisabled(), true);
  await page.getByRole('checkbox').check(); assert.equal(await commit.isEnabled(), true); await commit.click(); await page.waitForFunction(() => window.committedSongLibrary?.snapshot.songs.length === 1);
  assert.deepEqual(service.read().snapshot, data);
  // A forged oversized File proves the size check runs before reading/allocating its contents.
  await page.evaluate(() => { const input = document.querySelector('input[type=file]'), file = new File([], 'oversized.json'); Object.defineProperty(file, 'size', { value: 64 * 1024 * 1024 + 1 }); file.arrayBuffer = () => { throw new Error('must not read oversized file'); }; const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.getByRole('alert').waitFor(); assert.match(await page.getByRole('alert').innerText(), /64 MiB/);
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByLabel('新资料库快照内容').fill(JSON.stringify(data)); await page.getByRole('button', { name: '校验并预览影响' }).click(); await commit.waitFor();
  await mkdir(join(project, 'local/song-library-stage1'), { recursive: true }); await page.screenshot({ path: join(project, 'local/song-library-stage1/backup-panel-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); assert.deepEqual(errors, []); assert.deepEqual(external, []);
});
