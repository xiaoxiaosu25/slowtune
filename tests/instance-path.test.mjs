import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfigFile } from '../scripts/instance-path.mjs';

const source = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(source, 'local/instance-path-tests');
mkdirSync(output, { recursive: true });
function fixture() {
  const base = mkdtempSync(join(output, 'workspace-'));
  const root = join(base, 'projects/slowtune');
  const instance = join(base, 'instances/slowtune/config.local.json');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(base, 'platform'));
  writeFileSync(join(base, 'AGENTS.md'), '# Workspace');
  writeFileSync(join(base, 'platform/AGENTS.md'), '# Platform');
  mkdirSync(dirname(instance), { recursive: true });
  writeFileSync(instance, JSON.stringify({ database: './library.sqlite' }));
  return { base, root, instance };
}

test('Workspace commands find the sibling instance while local and explicit configurations retain priority', () => {
  const { base, root, instance } = fixture();
  assert.equal(resolveConfigFile(root, {}), instance);
  const missing = join(base, 'missing.json');
  assert.equal(resolveConfigFile(root, { MUSIC_APP_CONFIG: missing }), missing);
  const local = join(root, 'config.local.json');
  writeFileSync(local, '{}');
  assert.equal(resolveConfigFile(root, {}), local);
  assert.equal(resolveConfigFile(root, { MUSIC_APP_CONFIG: instance }), instance);
});

test('Portable deliveries use their own configuration even beside a workspace instance', () => {
  const { base } = fixture();
  const root = join(base, 'releases/slowtune');
  mkdirSync(root, { recursive: true });
  assert.equal(resolveConfigFile(root, {}), join(root, 'config.local.json'));
});

test('Foreground startup passes the workspace instance configuration from an unrelated cwd', () => {
  const { base, root, instance } = fixture();
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'dist/server'), { recursive: true });
  for (const file of ['start.mjs', 'instance-path.mjs']) {
    copyFileSync(join(source, 'scripts', file), join(root, 'scripts', file));
  }
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, 'dist/server/index.js'), 'console.log(JSON.stringify({config:process.env.MUSIC_APP_CONFIG}));\n');
  const env = { ...process.env };
  delete env.MUSIC_APP_CONFIG;
  const result = execFileSync(process.execPath, [join(root, 'scripts/start.mjs')], { cwd: base, env, encoding: 'utf8', windowsHide: true });
  assert.equal(JSON.parse(result).config, instance);
});
