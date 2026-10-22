import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DesktopState, DesktopFile, readDesktopState, savePreferences } from '../desktop/storage.mjs';
import { restoreLyricsPreferences } from '../desktop/model.mjs';
import { developmentPaths } from '../scripts/workspace-paths.mjs';

const output = join(developmentPaths().testRuntime, 'desktop-state-tests');
function directory(t) { mkdirSync(output, { recursive: true }); const data = mkdtempSync(join(output, 'isolated-')); t.after(() => rmSync(data, { recursive: true, force: true })); return data; }
const gate = () => { let release; const promise = new Promise(done => { release = done; }); return { promise, release }; };

test('missing state is a first launch; partial current fields retain the established defaults', t => {
  const data = directory(t), state = new DesktopState(data);
  assert.deepEqual(state.read(), {}); assert.equal(existsSync(state.file), false);
  writeFileSync(state.file, JSON.stringify({ windowBounds: { x: 20 }, lyrics: { fontSize: 100 }, lyricsDefaultsVersion: 1 }));
  const saved = new DesktopState(data).read();
  assert.equal(saved.windowBounds.x, 20); assert.equal(restoreLyricsPreferences(saved).fontSize, 64);
  assert.equal(restoreLyricsPreferences(saved).visible, true);
});

test('invalid JSON and invalid state formats never return a writable state or alter the original bytes', t => {
  const data = directory(t), file = join(data, 'desktop-state.json');
  for (const [json, code] of [['{broken', 'state-json-invalid'], ['null', 'state-format-invalid'], ['[]', 'state-format-invalid'], ['{"lyrics":[]}', 'state-format-invalid'], ['{"windowBounds":{"x":"bad"}}', 'state-format-invalid']]) {
    writeFileSync(file, json);
    assert.throws(() => new DesktopState(data), { code });
    assert.equal(readFileSync(file, 'utf8'), json); assert.equal(existsSync(file + '.tmp'), false);
  }
});

test('read errors stay distinct from absence, with actionable retry and no write', () => {
  for (const code of ['EACCES', 'EPERM', 'EIO', 'ENOSPC']) {
    assert.throws(() => readDesktopState('unused', () => { throw Object.assign(new Error('private path'), { code }); }), error => {
      assert.equal(error.code, 'state-read-failed'); assert.equal(error.cause.code, code);
      assert.match(error.message, /原文件未改动.*重试/); assert(!error.message.includes('private path')); return true;
    });
  }
  assert.deepEqual(readDesktopState('unused', () => { throw Object.assign(new Error(), { code: 'ENOENT' }); }), {});
});

test('window state and welcome snapshots serialize writes and acknowledge only the committed revision', async t => {
  for (const name of ['desktop-state.json', 'welcome.json']) {
    const data = directory(t), started = gate(), blocked = gate(), snapshots = []; let active = 0, peak = 0;
    const writer = new DesktopFile(join(data, name), { persist: async (file, json) => {
      peak = Math.max(peak, ++active); snapshots.push(JSON.parse(json));
      if (snapshots.length === 1) { started.release(); await blocked.promise; }
      await savePreferences(file, json); active--;
    } });
    const one = writer.writeSnapshot({ value: 'one' }), flushing = writer.flush(); await started.promise;
    let acknowledged = false; const input = { value: 'two' };
    const two = writer.writeSnapshot(input).then(() => { acknowledged = true; }); input.value = 'external mutation';
    assert.equal(acknowledged, false); blocked.release();
    await Promise.all([one, two, flushing, writer.flush()]);
    assert.equal(peak, 1); assert.deepEqual(snapshots, [{ value: 'one' }, { value: 'two' }]);
    assert.deepEqual(JSON.parse(readFileSync(writer.file)), { value: 'two' });
  }
});

test('a failed state write preserves last state and latest memory, then flush retries without another edit', async t => {
  const data = directory(t), writer = new DesktopState(data); await writer.writeSnapshot({ windowTheme: 'dark' });
  const old = readFileSync(writer.file, 'utf8');
  mkdirSync(writer.file + '.tmp');
  const failed = assert.rejects(writer.writeSnapshot({ windowTheme: 'light' }), /尚未保存/);
  await assert.rejects(writer.flush()); await failed;
  assert.equal(readFileSync(writer.file, 'utf8'), old); assert.equal(writer.read().windowTheme, 'light');
  assert.equal(writer.state().pending, true); assert(writer.state().error);
  rmSync(writer.file + '.tmp', { recursive: true }); await writer.flush();
  assert.equal(new DesktopState(data).read().windowTheme, 'light'); assert.deepEqual(writer.state(), { pending: false, error: null });
});
