import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateLyricSource } from '../scripts/generate-lyric-source.mjs';

test('corresponding-source bundle includes build inputs and excludes instance credentials and media data', t => {
  const root = mkdtempSync(join(tmpdir(), 'slowtune-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['src', 'server', 'scripts', 'tests', 'docs', 'vendor', 'legal', 'public/assets', 'public/fonts', 'local', 'runtime', 'data', 'desktop']) mkdirSync(join(root, path), { recursive: true });
  for (const path of ['package.json', 'src/app.ts', 'server/index.ts', 'scripts/build.mjs', 'tests/app.test.mjs', 'desktop/main.mjs', 'docs/中文说明.md', 'legal/LICENSE.txt', 'vendor/public.tgz', 'public/fonts/font.woff2', 'start.cmd', 'config.local.json', 'runtime/account.json', 'data/library.sqlite', 'local/private.txt']) writeFileSync(join(root, path), path);
  writeFileSync(join(root, 'workspace.paths.json'), JSON.stringify({ schemaVersion: 1, project: 'slowtune', paths: { studio: '../..', build: '../../local/build/slowtune', artifacts: '../../local/artifacts/slowtune', testRuntime: '../../local/runtime/slowtune' } }));
  const files = generateLyricSource(root);
  assert(files.includes('src/app.ts')); assert(files.includes('start.cmd')); assert(files.includes('tests/app.test.mjs')); assert(files.includes('desktop/main.mjs'));
  assert(files.includes('workspace.paths.json'), 'the source archive must include the declared build paths');
  assert(!files.some(path => /config\.local|runtime\/|data\/|local\//.test(path)));
  const extracted = join(root, 'extracted'); mkdirSync(extracted);
  execFileSync('tar', ['-xzf', join(root, 'public/legal/desktop-lyrics-source.tar.gz'), '-C', extracted], { windowsHide: true });
  const archive = readdirSync(extracted, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name).slice(extracted.length + 1).replaceAll('\\', '/'));
  assert.deepEqual(archive.sort(), files);
  assert.equal(readFileSync(join(extracted, 'docs/中文说明.md'), 'utf8'), 'docs/中文说明.md');
  assert.deepEqual(JSON.parse(readFileSync(join(extracted, 'workspace.paths.json'), 'utf8')), JSON.parse(readFileSync(join(root, 'workspace.paths.json'), 'utf8')));
  assert.equal(readFileSync(join(root, 'public/legal/source-files.txt'), 'utf8'), files.join('\n') + '\n');
});
