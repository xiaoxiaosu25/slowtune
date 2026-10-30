import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from './helpers/browser.mjs';

test('desktop sleep timer: form, replacement, completion and host actions', { timeout: 90000 }, async t => {
  const artifact = await build({ configFile: false, plugins: [react()], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', build: { write: false,
    lib: { entry: fileURLToPath(new URL('./helpers/sleep-timer-probe.jsx', import.meta.url)), formats: ['es'] },
    rollupOptions: { output: { inlineDynamicImports: true } } } });
  const outputs = Array.isArray(artifact) ? artifact : [artifact];
  const bundle = outputs.flatMap(output => output.output).find(item => item.type === 'chunk' && item.isEntry).code;
  const audio = Buffer.alloc(44 + 8000 * 3 * 2);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  const server = createServer((request, response) => {
    if (request.url === '/probe.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end(bundle); }
    if (request.url.startsWith('/audio.wav')) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
      const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), audio.length - 1) : audio.length - 1;
      response.writeHead(match ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
        ...(match ? { 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : {}) });
      return response.end(audio.subarray(start, end + 1));
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/probe.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const open = async (query = '') => {
    await page.setViewportSize(query.includes('mobile') ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    await page.goto(origin + '/' + query);
    try { await page.waitForFunction(() => window.sleepProbe?.ready); }
    catch (failure) { throw new Error('Sleep probe did not mount: ' + errors.join('; '), { cause: failure }); }
  };
  const invoke = (method, ...args) => page.evaluate(({ method, args }) => window.sleepProbe[method](...args), { method, args });
  const snapshot = () => invoke('snapshot');
  const field = name => page.locator(`[data-field="${name}"]`), submit = () => page.locator('[data-action="start-timer"]').click();
  const play = async () => { await invoke('play'); await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .1 && !document.querySelector('audio').paused); };
  const shortTimer = async (action = 'pause', seconds = '.3') => {
    await field('trigger').selectOption('duration'); await field('duration').fill(seconds);
    await field('unit').selectOption('1000'); await field('action').selectOption(action); await submit();
  };

  await t.test('same quick preset discards a different draft and resets its form', async () => {
    await open(); await page.locator('.sleep-preset').filter({ hasText: '45' }).click();
    await field('trigger').selectOption('items'); await field('count').fill('2'); await field('action').selectOption('stop');
    assert.match(await page.getByRole('status').textContent(), /修改尚未生效/);
    assert.equal((await snapshot()).trigger.type, 'duration');
    await page.locator('.sleep-preset').filter({ hasText: '45' }).click();
    assert.equal(await field('trigger').inputValue(), 'duration'); assert.equal(await field('duration').inputValue(), '45');
    assert.equal(await field('action').inputValue(), 'pause'); assert.equal(await page.getByRole('status').count(), 0);
  });
  await t.test('ticks preserve the draft, and applying items clears the old deadline', async () => {
    await open(); await shortTimer('pause', '2');
    await field('trigger').selectOption('items'); await field('count').fill('3');
    await page.waitForFunction(() => window.sleepProbe.snapshot().remainingMs < 900);
    assert.equal(await field('trigger').inputValue(), 'items'); assert.equal(await field('count').inputValue(), '3');
    await submit(); const active = await snapshot();
    assert.equal(active.deadline, null); assert.equal(active.remainingItems, 3);
    assert.equal(await page.locator('.sleep-preset[aria-pressed="true"]').count(), 0);
    await page.waitForTimeout(1100); assert.equal((await snapshot()).status, 'running');
    await field('trigger').selectOption('duration'); await field('duration').fill('60'); await submit();
    assert.equal((await snapshot()).remainingItems, null); assert.equal((await snapshot()).trigger.type, 'duration');
  });
  await t.test('invalid inputs keep the running rule, and repeated item rules reset the count', async () => {
    await open(); await field('trigger').selectOption('items'); await field('count').fill('2'); await submit();
    for (const value of ['0', '-1', '1.5', '9007199254740992', '']) {
      await field('count').fill(value); await submit();
      assert.equal((await snapshot()).remainingItems, 2); assert.equal((await snapshot()).status, 'running');
    }
    await invoke('start', { trigger: { type: 'items', count: 4 } });
    assert.equal(await field('count').inputValue(), '4');
    await page.locator('[data-action="cancel-timer"]').click(); assert.equal((await snapshot()).status, 'idle');
    await page.locator('.sleep-current').click();
    assert.match(await page.getByRole('alert').textContent(), /请先播放/); assert.equal((await snapshot()).status, 'idle');
  });
  for (const query of ['', '?mobile']) await t.test(`${query ? 'mobile' : 'desktop'} manual next and seeking to the end do not count; natural loop completion counts exactly once`, async () => {
    await open(query); await play();
    await invoke('mode'); await invoke('mode'); await invoke('mode'); // sequential -> shuffle -> all -> one
    await field('trigger').selectOption('items'); await field('count').fill('2'); await submit();
    await invoke('next'); assert.equal((await snapshot()).remainingItems, 2);
    const before = (await snapshot()).preparations;
    await page.locator('audio').evaluate(audio => { audio.currentTime = audio.duration; });
    await page.waitForFunction(before => window.sleepProbe.snapshot().preparations > before && !document.querySelector('audio').paused, before);
    assert.equal((await snapshot()).remainingItems, 2);
    await invoke('rate', 2);
    await page.waitForFunction(() => window.sleepProbe.snapshot().remainingItems === 1);
    await submit(); assert.equal((await snapshot()).remainingItems, 2, 'submitting the same rule restarts the count');
    await page.waitForFunction(() => window.sleepProbe.snapshot().status === 'expired');
    assert.equal((await snapshot()).remainingItems, 0); assert(await page.locator('audio').evaluate(audio => audio.paused));
    const ended = (await snapshot()).preparations;
    await page.waitForTimeout(250); assert.equal((await snapshot()).preparations, ended, 'the final completion cannot advance or repeat');
  });
  await t.test('current-track rule follows a manual selection and pauses at its natural end', async () => {
    await open(); await play(); await page.locator('.sleep-current').click();
    await invoke('next'); assert.equal((await snapshot()).remainingItems, 1);
    assert.equal(await page.locator('.sleep-summary strong').textContent(), '播完当前曲');
    await invoke('rate', 2); await page.waitForFunction(() => window.sleepProbe.snapshot().status === 'expired');
    assert(await page.locator('audio').evaluate(audio => audio.paused));
  });
  await t.test('duration expires during pause; cancel and replacing it prevent a late pause', async () => {
    await open(); await play(); await invoke('toggle'); await shortTimer();
    await page.waitForFunction(() => window.sleepProbe.snapshot().status === 'expired');
    assert(await page.locator('audio').evaluate(audio => audio.paused));
    await play(); await shortTimer('pause', '.6'); await page.locator('[data-action="cancel-timer"]').click();
    await page.waitForTimeout(800); assert.equal((await snapshot()).status, 'idle');
    assert.equal(await page.locator('audio').evaluate(audio => audio.paused), false);
  });
  await t.test('stop releases media and retains the queue; close requests desktop quit only on successful completion', async () => {
    await open('?host'); await play(); const current = (await snapshot()).currentId;
    await shortTimer('stop'); await page.waitForFunction(() => window.sleepProbe.snapshot().status === 'expired' && !window.sleepProbe.snapshot().actionPending);
    assert.equal((await snapshot()).state, 'stopped'); assert.equal((await snapshot()).currentId, current);
    assert.equal(await page.locator('audio').getAttribute('src'), null); assert.equal((await snapshot()).quits, 0);
    await play(); await shortTimer('close');
    await page.waitForFunction(() => window.sleepProbe.snapshot().quits === 1);
    assert.equal((await snapshot()).state, 'stopped'); assert.equal((await snapshot()).actionPending, false);
  });
  await t.test('expiry prevents a pending explicit song selection from starting late', async () => {
    await open(); await play(); await shortTimer('pause', '.6'); await invoke('deferSelection');
    await page.waitForFunction(() => window.sleepProbe.snapshot().status === 'expired');
    const before = (await snapshot()).preparations;
    await invoke('releaseSelection'); await page.waitForFunction(() => !window.sleepProbe.snapshot().preparing);
    assert.equal((await snapshot()).preparations, before); assert(await page.locator('audio').evaluate(audio => audio.paused));
  });
  await t.test('desktop browser omits unsupported quit; reload clears rules; mobile keeps its existing form', async () => {
    await open(); assert.equal(await field('action').locator('option[value="close"]').count(), 0);
    await page.locator('.sleep-preset').filter({ hasText: '30' }).click();
    await open(); assert.equal((await snapshot()).status, 'idle');
    await open('?mobile'); assert.equal(await field('action').locator('option[value="close"]').textContent(), '关闭播放器');
    await page.locator('.sleep-preset').filter({ hasText: '30' }).click(); await field('trigger').selectOption('items');
    assert.equal(await page.getByRole('status').count(), 0);
    assert.equal(await page.locator('[data-action="start-timer"]').textContent(), '重新设置');
  });
  assert.deepEqual(errors, []);
});
