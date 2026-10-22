import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateLyricSource } from '../scripts/generate-lyric-source.mjs';
import { exportPublicSource } from '../scripts/export-source.mjs';
import { developmentPaths } from '../scripts/workspace-paths.mjs';
import { publicRepositoryErrors } from '../scripts/check-public-repository.mjs';

test('corresponding-source bundle includes build inputs and excludes instance credentials and media data', t => {
  const root = mkdtempSync(join(tmpdir(), 'slowtune-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['src', 'server', 'scripts', 'tests', 'docs/开发', 'vendor', 'legal', 'public/assets', 'public/fonts', 'local', 'runtime', 'data', 'desktop', 'maintainer/tests', '.github/workflows']) mkdirSync(join(root, path), { recursive: true });
  for (const path of ['README.md', 'CONTRIBUTING.md', 'LICENSE', 'NOTICE', 'package.json', 'src/app.ts', 'server/index.ts', 'scripts/build.mjs', 'tests/app.test.mjs', 'desktop/main.mjs', 'docs/开发/开发约定.md', 'docs/内部记录.md', 'AGENTS.md', '项目说明.md', 'legal/LICENSE.txt', 'vendor/public.tgz', 'public/fonts/font.woff2', '一键启动.cmd', 'private.cmd', 'config.local.json', 'runtime/account.json', 'data/library.sqlite', 'local/private.txt']) writeFileSync(join(root, path), path);
  writeFileSync(join(root, 'workspace.paths.json'), JSON.stringify({ schemaVersion: 1, project: 'slowtune', paths: { studio: '../..', build: '../../local/build/slowtune', artifacts: '../../local/artifacts/slowtune', testRuntime: '../../local/runtime/slowtune' } }));
  writeFileSync(join(root, 'maintainer/tests/stage5-compatibility.test.mjs'), 'private baseline comparison');
  writeFileSync(join(root, '.github/workflows/check.yml'), 'name: Check');
  const files = generateLyricSource(root);
  assert(files.includes('src/app.ts')); assert(files.includes('一键启动.cmd')); assert(files.includes('tests/app.test.mjs')); assert(files.includes('desktop/main.mjs'));
  assert(!files.some(path => ['workspace.paths.json', 'AGENTS.md', '项目说明.md', 'docs/内部记录.md', 'private.cmd'].includes(path) || path.startsWith('maintainer/')), 'author workspace inputs must not enter public source');
  assert(files.includes('.github/workflows/check.yml'), 'public collaboration configuration must survive export');
  assert.deepEqual(publicRepositoryErrors(root, ['README.md', 'src/app.ts', '.github/workflows/check.yml']), []);
  for (const privateFile of ['maintainer', 'maintainer/plan.md', 'workspace.paths.json', '项目说明.md', 'data/library.sqlite', 'test-results/report.json']) {
    assert.equal(publicRepositoryErrors(root, [privateFile]).length, 1, privateFile);
  }
  for (const file of ['README.md', 'CONTRIBUTING.md', 'LICENSE', 'NOTICE']) assert(files.includes(file));
  assert(!files.some(path => /config\.local|runtime\/|data\/|local\//.test(path)));
  const extracted = join(root, 'extracted'); mkdirSync(extracted);
  execFileSync('tar', ['-xzf', join(root, 'public/legal/desktop-lyrics-source.tar.gz'), '-C', extracted], { windowsHide: true });
  const archive = readdirSync(extracted, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name).slice(extracted.length + 1).replaceAll('\\', '/'));
  assert.deepEqual(archive.sort(), files);
  assert.equal(readFileSync(join(extracted, 'docs/开发/开发约定.md'), 'utf8'), 'docs/开发/开发约定.md');
  assert.equal(developmentPaths(extracted).desktopBuild, join(extracted, 'local/desktop-build'));
  assert.equal(readFileSync(join(root, 'public/legal/source-files.txt'), 'utf8'), files.join('\n') + '\n');
  const exported = join(root, 'exported');
  assert.deepEqual(exportPublicSource(root, exported), files);
  assert.equal(developmentPaths(exported).desktopBuild, join(exported, 'local/desktop-build'));
  assert.throws(() => exportPublicSource(root, exported), /new directory/);
  writeFileSync(join(root, 'src/config.local.json'), 'private');
  assert.throws(() => generateLyricSource(root), /Private or generated file/);
});
