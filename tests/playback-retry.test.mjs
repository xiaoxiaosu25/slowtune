import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from './helpers/browser.mjs';

test('product manual recovery uses the failed source, position and newest transport intent', { timeout: 180000 }, async t => {
  const artifact = await build({ configFile: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' }, build: { target: 'esnext', write: false, minify: false,
    lib: { entry: fileURLToPath(new URL('./helpers/playback-retry-probe.tsx', import.meta.url)), formats: ['es'] },
    rollupOptions: { output: { inlineDynamicImports: true } } } });
  const bundle = (Array.isArray(artifact) ? artifact : [artifact]).flatMap(a => a.output).find(a => a.isEntry).code;
  const audio = Buffer.alloc(44 + 8000 * 180 * 2);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  for (let i = 44; i < audio.length; i += 2) audio.writeInt16LE(Math.round(1000 * Math.sin(i * Math.PI / 20)), i);
  const ref = part => ({ provider: 'bilibili', kind: 'video', id: 'BV1tX4y1W7Xm', part });
  const entry = r => ({ ref: r, resourceId: 'source-' + r.part, title: '来源 ' + r.part, url: 'https://www.bilibili.com/video/' + r.id, durationSeconds: 180 });
  const leases = [], released = new Set(), streams = new Set(), records = [], errors = [], external = [], requests = [];
  let fault, failPrepare = false, gate, serial = 0;
  const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push({ path: url.pathname, method: req.method, injected: url.pathname === '/audio.wav' && fault === url.searchParams.get('lease') || url.pathname === '/v1/call/prepare' && failPrepare });
    if (url.pathname === '/probe.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(bundle); }
    if (url.pathname === '/v1/handshake') return json(res, { protocol: 2, capabilities: [{ provider: 'bilibili', operations: ['metadata', 'prepare'], anonymous: true, limitations: [] }] });
    if (url.pathname.startsWith('/v1/leases/')) { if (req.method === 'DELETE') released.add(url.pathname.split('/').at(-1)); res.writeHead(204); return res.end(); }
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks));
      if (url.pathname === '/v1/call/metadata') return json(res, { protocol: 2, result: { ...entry({ ...body.ref, part: body.ref.part ?? '900' }), parts: ['900', '901'].map(part => entry(ref(part))) } });
      if (url.pathname === '/v1/call/prepare') {
        if (failPrepare) return json(res, { protocol: 2, error: { code: 'network', retryable: true } }, 503);
        const leaseId = ('lease-' + (++serial)).padEnd(32, '_'), selected = body.request.ref; leases.push({ leaseId, ref: selected });
        if (gate) { const current = gate; gate = undefined; current.started = true; await current.promise; }
        return json(res, { protocol: 2, result: { resourceId: entry(selected).resourceId, entry: entry(selected), leaseId,
          format: { id: 'wav', codec: 'pcm', mimeType: 'audio/wav', container: 'wav' }, delivery: { requiresHost: false, url: `http://127.0.0.1:${server.address().port}/audio.wav?lease=${leaseId}` } } });
      }
    }
    if (url.pathname === '/audio.wav') {
      const lease = url.searchParams.get('lease');
      if (fault === lease) { res.writeHead(503); return res.end(); }
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? ''), start = Number(range?.[1] ?? 0), end = range?.[2] ? Math.min(+range[2], audio.length - 1) : audio.length - 1;
      res.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : {}) });
      let at = start; const stream = { lease, res }; streams.add(stream);
      const timer = setInterval(() => { const next = Math.min(at + 8192, end + 1); res.write(audio.subarray(at, next)); at = next; if (at > end) { clearInterval(timer); res.end(); } }, 40);
      res.on('close', () => { clearInterval(timer); streams.delete(stream); }); return;
    }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/probe.js"></script>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  t.after(async () => { gate?.release(); await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); const out = resolve('local/playback-retry'); mkdirSync(out, { recursive: true }); writeFileSync(out + '/regression.json', JSON.stringify({ records, leases, released: [...released], requests, errors, external }, null, 2)); });
  const page = await browser.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(()=>{window.resumeCallbacks=[];window.slowTuneDesktop={readPreferences:async()=>Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('slow-listening:')).map(key=>[key,localStorage.getItem(key)])),writePreference:async(key,value)=>{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);},onCommand:callback=>{window.resumeCallbacks.push(callback);return ()=>{};}};});
  await page.route('**/*', route => { if (route.request().url().startsWith(origin + '/')) return route.continue(); external.push(route.request().url()); return route.abort(); });
  await page.goto(origin); await page.waitForFunction(() => !!window.playbackProbe);
  const invoke = (method, ...args) => page.evaluate(({ method, args }) => window.playbackProbe[method](...args), { method, args });
  const snap = () => page.evaluate(() => { const a = document.querySelector('audio'), p = window.playbackProbe; return { time: a.currentTime, paused: a.paused, src: a.currentSrc, current: p.snapshot.currentId, items: p.snapshot.items.map(i => i.resourceId), error: p.error, preparing: p.preparing }; });
  const playing = () => page.waitForFunction(() => { const a = document.querySelector('audio'); return !a.paused && a.currentTime > .1; });
  const start = async () => { fault = undefined; failPrepare = false; const ok = await invoke('playAll', [entry(ref('900')), entry(ref('901'))]); assert.equal(ok, true, JSON.stringify(await snap())); await playing(); };
  const terminal = async paused => {
    if (paused) await invoke('toggle');
    fault = new URL((await snap()).src).searchParams.get('lease'); failPrepare = true;
    for (const stream of streams) if (stream.lease === fault) stream.res.destroy();
    await page.evaluate(() => { document.querySelector('audio').currentTime = 120; });
    await page.waitForFunction(() => !!window.playbackProbe.error); failPrepare = false;
  };
  const delayPrepare = () => { let release; const promise = new Promise(r => release = r); const delayed = { promise, release, started: false }; gate = delayed; return delayed; };
  const until = async (condition, message) => { for (let i = 0; i < 300 && !condition(); i++) await new Promise(r => setTimeout(r, 10)); assert(condition(), message); };
  const beginRetry = () => page.evaluate(() => { window.retryTask = window.playbackProbe.retry(); });
  const recovered = paused => page.waitForFunction(paused => { const a = document.querySelector('audio'); return a.currentTime >= 120 && a.currentTime < 125 && a.readyState >= 2 && a.paused === paused; }, paused);
  await t.test('native media read failure plus recovery prepare 503 then manual retry preserves 120 seconds', async () => {
    await start(); const before = await snap(); await terminal(false); const failed = await snap();
    await page.getByRole('button', { name: '重试播放' }).click(); await playing();
    records.push({ name: 'manual-retry-first-play', before, failed, after: await snap() });
    await page.waitForFunction(() => document.querySelector('audio').currentTime >= 120, undefined, { timeout: 4000 });
    const after = await snap(); assert.equal(after.current, before.current); assert.deepEqual(after.items, before.items); assert.equal(leases.at(-1).ref.part, '900'); assert(after.time < 125);
    records.push({ name: 'manual-retry', before, failed, after });
  });
  await t.test('paused failure and a new pause during delayed retry stay paused at the checkpoint', async () => {
    for (const pausedFirst of [true, false]) {
      await start(); await terminal(pausedFirst); const before = await snap(), delayed = delayPrepare(); await beginRetry(); await until(() => delayed.started, 'retry did not prepare');
      if (!pausedFirst) await invoke('toggle'); delayed.release(); await recovered(true);
      const after = await snap(); await new Promise(r => setTimeout(r, 200)); assert(Math.abs((await snap()).time - after.time) < .05); assert.equal(after.current, before.current);
      records.push({ name: 'paused-retry', pausedFirst, before, after });
      await invoke('toggle'); await recovered(false);
    }
  });
  await t.test('cancel, next, and rapid retries reject late results and release unused leases', async () => {
    for (const action of ['cancel', 'next', 'retry']) {
      await start(); await terminal(false); const before = await snap(), delayed = delayPrepare(); await beginRetry(); await until(() => delayed.started, 'retry not started'); const abandoned = leases.at(-1).leaseId;
      await invoke(action); if (action === 'next') await playing(); if (action === 'retry') await recovered(false);
      const winner = await snap(), active = new URL(winner.src).searchParams.get('lease'); delayed.release();
      await until(() => released.has(abandoned), 'late lease was not released');
      const after = await snap(); assert.equal(after.current, winner.current);
      if (action === 'cancel') assert.equal(after.paused, true);
      else { assert.equal(after.paused, false); assert(!released.has(active), 'late cleanup released the active lease'); }
      if (action === 'next') { assert.notEqual(after.current, before.current); assert(after.time < 3); assert.equal(leases.find(l => l.leaseId === active).ref.part, '901'); }
      records.push({ name: 'late-' + action, before, after, abandonedReleased: released.has(abandoned), activeRetained: !released.has(active) });
    }
  });
  await t.test('another failed manual preparation retains the checkpoint for a later retry', async () => {
    await start(); await terminal(false); const current = (await snap()).current; failPrepare = true; assert.equal(await invoke('retry'), false); failPrepare = false;
    assert.equal((await snap()).current, current); await invoke('retry'); await recovered(false); records.push({ name: 'repeated-prepare-failure', after: await snap() });
  });
  await t.test('a later failure at zero cannot reuse the earlier recovered checkpoint', async () => {
    await start(); await terminal(false); await invoke('retry'); await recovered(false);
    await invoke('toggle'); await invoke('seek', 0); await page.waitForFunction(() => !document.querySelector('audio').seeking);
    failPrepare = true; await page.evaluate(() => document.querySelector('audio').dispatchEvent(new Event('error'))); await page.waitForFunction(() => !!window.playbackProbe.error); failPrepare = false;
    await invoke('retry'); await page.waitForFunction(() => document.querySelector('audio').readyState >= 2); const after = await snap(); assert(after.time < .1); assert.equal(after.paused, true); records.push({ name: 'later-zero-failure', kind: 'native error event injection after explicit zero seek', after });
  });
  await t.test('direct selection, song default and fixed version retry their committed source despite default edits', async () => {
    const versions = ['900', '901'].map(part => ({ id: 'v' + part, songId: 'song', ref: ref(part), facts: { title: '来源 ' + part, artists: [] } }));
    for (const kind of ['source', 'default', 'pinned']) {
      fault = undefined; failPrepare = false;
      await invoke('updateSongs', [{ id: 'song', title: '歌曲', defaultVersionId: 'v900' }], versions);
      const selection = kind === 'source' ? { kind: 'source', ref: ref('900') } : { kind: 'song', songId: 'song', ...(kind === 'pinned' ? { pinnedVersionId: 'v900' } : {}) };
      await invoke('playSelections', [{ selection, song: { title: '歌曲' } }]); await playing(); const before = await snap(); await terminal(false);
      await invoke('updateSongs', [{ id: 'song', title: '歌曲', defaultVersionId: 'v901' }], versions);
      await invoke('retry'); await recovered(false); assert.equal(leases.at(-1).ref.part, '900'); assert.equal((await snap()).current, before.current);
      records.push({ name: kind + '-exact-source-retry', after: await snap(), ref: leases.at(-1).ref });
      await invoke('select', before.current); await playing(); assert((await snap()).time < 3); assert.equal(leases.at(-1).ref.part, kind === 'default' ? '901' : '900');
    }
  });
  await t.test('online, page restore and native wake notifications coalesce into one automatic recovery at 120 seconds',async()=>{
    await start();await terminal(false);const before=await snap(),count=leases.length;
    await page.evaluate(()=>{window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('pageshow'));for(const callback of window.resumeCallbacks)callback('resync');});
    await recovered(false);assert.equal(leases.length,count+1);assert.equal((await snap()).current,before.current);assert.deepEqual((await snap()).items,before.items);
    records.push({name:'coalesced-network-native-wake',before,after:await snap(),newPreparations:leases.length-count});
    await invoke('toggle');const paused=leases.length;
    await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));for(const callback of window.resumeCallbacks)callback('resync');});
    await new Promise(resolve=>setTimeout(resolve,200));assert.equal(leases.length,paused);assert.equal((await snap()).paused,true);
  });
  await t.test('normal selection, next, previous and explicit version switching start at zero; reload is silent', async () => {
    await start(); await terminal(false); await invoke('retry'); await recovered(false); const before = await snap();
    await invoke('next'); await playing(); assert((await snap()).time < 3); await invoke('previous'); await playing(); assert.equal((await snap()).current, before.current); assert((await snap()).time < 3);
    await invoke('updateSongs', [{ id: 'song', title: '歌曲', defaultVersionId: 'v900' }], ['900', '901'].map(part => ({ id: 'v' + part, songId: 'song', ref: ref(part), facts: { title: '来源 ' + part, artists: [] } })));
    await invoke('playSelection', { kind: 'song', songId: 'song' }, { title: '歌曲' }); await playing(); const current = (await snap()).current;
    await invoke('seek', 60); await invoke('playSelection', { kind: 'song', songId: 'song', explicitVersionId: 'v901' }, { title: '歌曲' }); await playing(); assert.equal((await snap()).current, current); assert((await snap()).time < 3); assert.equal(leases.at(-1).ref.part, '901');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('slow-listening:playback:v3'))); const count = leases.length;
    // Await deterministic cleanup before navigation; pagehide network delivery is
    // best effort and the real service separately owns abandoned lease expiry.
    await invoke('release'); await page.reload(); await page.waitForFunction(() => !!window.playbackProbe?.snapshot.items.length); await new Promise(r => setTimeout(r, 100)); assert.equal((await snap()).paused, true); assert.equal((await snap()).time, 0); assert.equal(leases.length, count);
    assert.equal((await snap()).current, saved.current); records.push({ name: 'normal-zero-and-silent-reload', after: await snap() });
  });
  await invoke('release'); await until(() => leases.every(l => released.has(l.leaseId)), 'all bridge leases must be released');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
});
