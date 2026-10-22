import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureLocalProfile, localProfilePath } from '../desktop/profile.mjs';

test('desktop automatically creates an isolated loopback profile and preserves existing configuration and data', async () => {
  const output = resolve('local/desktop-profile-tests'); mkdirSync(output, { recursive: true });
  const data = mkdtempSync(join(output, 'profile with spaces-'));
  const file = await ensureLocalProfile(data), initial = readFileSync(file, 'utf8'), config = JSON.parse(initial);
  assert.equal(file, localProfilePath(data));
  assert.equal(config.host, '127.0.0.1');
  assert.deepEqual(config.allowedHosts, ['localhost', '127.0.0.1']);
  assert.match(config.accessKey, /^[\w-]{43}$/);
  assert(Number.isInteger(config.port) && config.port > 0 && config.port <= 65535);
  assert.equal(await ensureLocalProfile(data), file);
  assert.equal(readFileSync(file, 'utf8'), initial);
  const existing = { ...config, accessKey: 'existing-user-code', port: 4198 };
  writeFileSync(file, JSON.stringify(existing));
  const saved = join(data, 'instance', 'saved-library'); writeFileSync(saved, 'existing data');
  await ensureLocalProfile(data);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), existing);
  assert.equal(readFileSync(saved, 'utf8'), 'existing data');
  const other = await ensureLocalProfile(mkdtempSync(join(output, 'other-')));
  assert.notEqual(JSON.parse(readFileSync(other, 'utf8')).accessKey, config.accessKey);
});
