import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright-core';

function wav(seconds = 30) {
  const rate = 8000, samples = seconds * rate, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(1000 * Math.sin(i * 2 * Math.PI * 440 / rate)), 44 + i * 2);
  return bytes;
}

test('stage-0 version switch proof with the fixed player, real queue, sleep timer and browser audio', { timeout: 60000 }, async t => {
  const artifact = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
    lib: { entry: fileURLToPath(new URL('./helpers/song-version-switch-probe.js', import.meta.url)), formats: ['es'] },
    rollupOptions: { output: { inlineDynamicImports: true } } } });
  const outputs = Array.isArray(artifact) ? artifact : [artifact];
  const bundle = outputs.flatMap(output => output.output).find(item => item.type === 'chunk' && item.isEntry).code;
  const audio = wav(), released = [], external = [], errors = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/probe.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end(bundle); }
    if (url.pathname.startsWith('/lease/')) { if (request.method === 'DELETE') released.push(url.pathname.slice(7)); response.setHeader('Content-Type', 'application/json'); return response.end('{}'); }
    if (url.pathname === '/audio.wav') {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
      response.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : {}) });
      return response.end(audio.subarray(start, end + 1));
    }
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><body><script type="module" src="/probe.js"></script></body></html>');
  });
  let browser;
  t.after(async () => { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.MUSIC_APP_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (route.request().url().startsWith(base + '/')) return route.continue(); external.push(route.request().url()); return route.abort(); });
  await page.goto(base); await page.waitForFunction(() => !!window.switchProbe);
  const invoke = (method, ...args) => page.evaluate(({ method, args }) => window.switchProbe[method](...args), { method, args });
  const snapshot = () => invoke('snapshot');
  const reset = async () => { await invoke('reset'); await page.waitForFunction(() => window.switchProbe.snapshot().state === 'playing' && !window.switchProbe.snapshot().paused); };
  const complete = id => page.waitForFunction(id => window.switchProbe.snapshot().requests.find(item => item.id === id)?.outcome !== 'preparing', id);

  await t.test('existing load pauses old audio on failure; same-resource replacement rejects another resource', async () => {
    await reset(); assert.equal(await invoke('crossResourceReplacement'), true);
    const result = await invoke('baselineFailure');
    assert.deepEqual(result, { pausedBeforeFailure: true, pausedAfterFailure: true, currentQueueId: null, state: 'error' });
  });
  await t.test('failed preparation leaves old audio, queue and playback intent running', async () => {
    await reset(); const before = await snapshot(), id = await invoke('begin', 'b');
    await invoke('fail', id); await complete(id);
    await page.waitForFunction(time => window.switchProbe.snapshot().time > time + .15, before.time);
    const after = await snapshot(); assert.equal(after.paused, false); assert.equal(after.version, 'a'); assert.equal(after.current, 'q1');
  });
  await t.test('cancel and rapid choices discard late plans without releasing the active source', async () => {
    await reset(); const old = (await snapshot()).leases[0], first = await invoke('begin', 'cancelled');
    await invoke('cancel'); await invoke('release', first); await complete(first);
    await page.waitForFunction(() => window.switchProbe.snapshot().requests[0].outcome === 'cancelled');
    assert.equal((await snapshot()).version, 'a'); assert(!released.includes(old));
    const late = await invoke('begin', 'late'), winner = await invoke('begin', 'winner');
    await invoke('release', winner); await complete(winner); await invoke('release', late); await complete(late);
    await page.waitForFunction(() => window.switchProbe.snapshot().version === 'winner' && !window.switchProbe.snapshot().paused);
    const after = await snapshot();
    assert.equal(after.current, 'q1'); assert.deepEqual(after.items, ['q1', 'q2']); assert.deepEqual(after.history, ['q1']);
    const discarded = after.leases.filter(lease => lease.startsWith('cancelled-') || lease.startsWith('late-'));
    for (let attempt = 0; attempt < 50 && !discarded.every(lease => released.includes(lease)); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert(discarded.every(lease => released.includes(lease)), 'discarded plans release their leases');
    assert(!released.includes(after.leases.find(lease => lease.startsWith('winner-'))));
    await invoke('refresh'); assert.equal((await snapshot()).version, 'winner', 'refresh follows the committed source alias');
  });
  await t.test('commit starts at zero and retains controls, queue mode, history and sleep item count', async () => {
    await reset(); await invoke('controls');
    await page.waitForFunction(() => window.switchProbe.snapshot().time > .3);
    const id = await invoke('begin', 'b'); await invoke('release', id); await complete(id);
    const after = await snapshot();
    assert.equal(after.version, 'b'); assert(after.time < .5); assert.equal(after.current, 'q1'); assert.equal(after.order, 'shuffle'); assert.equal(after.repeat, 'all');
    assert.deepEqual(after.history, ['q1']); assert.equal(after.remainingItems, 2); assert.equal(after.volume, .31); assert.equal(after.rate, 1.5);
  });
  await t.test('preparing alternatives cannot change the active refresh target, even after the bridge cache is evicted', async () => {
    await reset();
    for (let index = 0; index < 66; index++) {
      const id = await invoke('begin', 'discard' + index); await invoke('cancel'); await invoke('release', id); await complete(id);
    }
    await invoke('refresh');
    await page.waitForFunction(() => { const s = window.switchProbe.snapshot(); return s.liveLeases === 1 && s.state === 'playing' && !s.paused; });
    const after = await snapshot(); assert.equal(after.version, 'a'); assert.equal(after.current, 'q1'); assert.equal(after.paused, false);
  });
  await t.test('paused switching and pause while preparing preserve the newest pause intent', async () => {
    for (const pauseFirst of [true, false]) {
      await reset(); if (pauseFirst) await invoke('pause'); const id = await invoke('begin', 'b');
      if (!pauseFirst) await invoke('pause'); await invoke('release', id); await complete(id);
      const after = await snapshot(); assert.equal(after.version, 'b'); assert.equal(after.paused, true); assert(after.time < .1);
    }
    await reset(); await invoke('pause'); let id = await invoke('begin', 'explicit', true);
    await invoke('release', id); await complete(id);
    await page.waitForFunction(() => window.switchProbe.snapshot().version === 'explicit' && !window.switchProbe.snapshot().paused);
    await reset(); await invoke('pause'); id = await invoke('begin', 'explicit', true); await invoke('pause');
    await invoke('release', id); await complete(id); assert.equal((await snapshot()).paused, true);
  });
  await t.test('next, source disabling and sleep expiration invalidate delayed switches', async () => {
    for (const action of ['next', 'stop', 'disable', 'expire']) {
      await reset(); const id = await invoke('begin', 'late'); await invoke(action);
      if (action === 'expire') await page.waitForFunction(() => window.switchProbe.snapshot().sleep === 'expired');
      await invoke('release', id); await complete(id); const after = await snapshot();
      assert.notEqual(after.version, 'late');
      if (action === 'next') { assert.equal(after.current, 'q2'); assert.equal(after.version, 'next'); }
      if (action === 'expire') assert.equal(after.paused, true);
    }
  });
  assert.deepEqual(errors, []); assert.deepEqual(external, [], 'probe must not contact real platforms');
});
