import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DesktopStorage, savePreferences } from '../desktop/storage.mjs';
import { developmentPaths } from '../scripts/workspace-paths.mjs';

const output = join(developmentPaths().testRuntime, 'desktop-storage-tests');
const directory = t => { mkdirSync(output, { recursive: true }); const data = mkdtempSync(join(output, 'isolated-')); t.after(() => rmSync(data, { recursive: true, force: true })); return data; };
const gate = () => { let release; const promise = new Promise(done => { release = done; }); return { promise, release }; };

test('large queue preference bursts coalesce and flush the final edit without waiting for the debounce', async t => {
  let writes = 0;
  const data = directory(t), storage = new DesktopStorage(data, { persist: async (...args) => { writes++; await savePreferences(...args); } });
  const queue = JSON.stringify({ items: Array.from({ length: 5000 }, (_, i) => ({ instanceId: String(i), title: '隔离性能测试歌曲'.repeat(4), artists: ['受控歌手'], source: { provider: 'bilibili', id: 'fixture-' + i, part: String(i) }, artwork: 'fixture', duration: 240 })), current: '0', volume: .5 });
  await storage.write('slow-listening:playback:v3', queue); writes = 0;
  const start = performance.now(), timer = new Promise(done => setTimeout(() => done(performance.now() - start), 0)), pending = [];
  for (let i = 0; i < 100; i++) pending.push(storage.write('slow-listening:volume:v1', String(i)));
  const enqueueMs = performance.now() - start;
  await storage.flush(); await Promise.all(pending);
  t.diagnostic(JSON.stringify({ queueBytes: Buffer.byteLength(queue), changes: 100, enqueueMs, timerDelayMs: await timer, flushMs: performance.now() - start, diskWrites: writes }));
  assert.equal(writes, 1); assert.deepEqual(new DesktopStorage(data).read(), storage.read());
  assert.equal(new DesktopStorage(data).read()['slow-listening:volume:v1'], '99');
  assert.deepEqual(storage.state(), { pending: false, error: null });
});

test('edits during a disk write remain ordered; acknowledgements wait for their own committed revision', async t => {
  const first = gate(), started = gate(), snapshots = []; let active = 0, peak = 0;
  const storage = new DesktopStorage(directory(t), { persist: async (file, json) => {
    peak = Math.max(peak, ++active); snapshots.push(JSON.parse(json));
    if (snapshots.length === 1) { started.release(); await first.promise; }
    await savePreferences(file, json); active--;
  } });
  const one = storage.write('slow-listening:theme:v1', 'one');
  const flushing = storage.flush(); await started.promise;
  let acknowledged = false;
  const two = storage.write('slow-listening:theme:v1', 'two').then(() => { acknowledged = true; });
  const three = storage.write('slow-listening:removed:v1', 'value');
  const four = storage.write('slow-listening:removed:v1', null);
  assert.equal(acknowledged, false); first.release();
  await Promise.all([one, two, three, four, flushing, storage.flush()]);
  assert.equal(peak, 1); assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0]['slow-listening:theme:v1'], 'one');
  assert.deepEqual(snapshots[1], { 'slow-listening:theme:v1': 'two' });
});

test('an edit made immediately after its predecessor is acknowledged always gets a new disk write', { timeout: 5000 }, async t => {
  const data = directory(t), storage = new DesktopStorage(data);
  await storage.write('slow-listening:theme:v1', 'one');
  await storage.write('slow-listening:theme:v1', 'two');
  await storage.write('slow-listening:theme:v1', 'three');
  await storage.flush();
  assert.equal(new DesktopStorage(data).read()['slow-listening:theme:v1'], 'three');
});

test('a failed write preserves the last file and staged edits, reports failure, and allows a final flush retry', async t => {
  const data = directory(t), states = []; let fail = false;
  const storage = new DesktopStorage(data, { onState: state => states.push(state), persist: async (...args) => {
    if (fail) throw Object.assign(new Error('private path and credentials must not escape'), { code: 'ENOSPC' });
    await savePreferences(...args);
  } });
  await storage.write('slow-listening:theme:v1', 'old');
  const old = readFileSync(storage.file, 'utf8'); fail = true;
  const edit = storage.write('slow-listening:theme:v1', 'latest');
  const rejected = assert.rejects(edit, /尚未保存/);
  await assert.rejects(storage.flush(), { code: 'ENOSPC' }); await rejected;
  assert.equal(readFileSync(storage.file, 'utf8'), old);
  assert.equal(storage.read()['slow-listening:theme:v1'], 'latest');
  assert.deepEqual(storage.state(), { pending: true, error: 'ENOSPC' });
  fail = false; await storage.flush();
  assert.equal(new DesktopStorage(data).read()['slow-listening:theme:v1'], 'latest');
  assert.deepEqual(states.at(-1), { pending: false, error: null });
  assert.throws(() => storage.write('../secret', 'value'), /无效/);
  assert.throws(() => storage.write('slow-listening:large', 'x'.repeat(8 * 1024 * 1024 + 1)), /无效/);
});

test('the existing 32 MiB serialized limit accepts its exact boundary and rejects overflow without changing staged data', async t => {
  const value = 'x'.repeat(8 * 1024 * 1024), limit = 32 * 1024 * 1024;
  const values = { 'slow-listening:a': value, 'slow-listening:b': value, 'slow-listening:c': value, 'slow-listening:d': '' };
  values['slow-listening:d'] = 'x'.repeat(limit - Buffer.byteLength(JSON.stringify(values)));
  let persistedBytes;
  const storage = new DesktopStorage(directory(t), { persist: async (_file, json) => { persistedBytes = Buffer.byteLength(json); } });
  const pending = Object.entries(values).map(([key, value]) => storage.write(key, value));
  assert.throws(() => storage.write('slow-listening:overflow', 'x'), /超过保存上限/);
  assert.equal(storage.read()['slow-listening:overflow'], undefined);
  await storage.flush(); await Promise.all(pending);
  assert.equal(persistedBytes, limit);
});
