import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { developmentPaths, desktopBuildDirectory, assertDesktopBuildDirectory } from '../scripts/workspace-paths.mjs';
import { desktopLaunchOptions } from '../scripts/desktop.mjs';

const runtime = developmentPaths().testRuntime; mkdirSync(runtime, { recursive: true });
function fixture() {
  const studio = mkdtempSync(join(runtime, 'workspace paths with spaces-')), root = join(studio, 'projects/slowtune');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'workspace.paths.json'), JSON.stringify({ schemaVersion: 1, project: 'slowtune', paths: { studio: '../..', build: '../../local/build/slowtune', artifacts: '../../local/artifacts/slowtune', testRuntime: '../../local/runtime/slowtune' } }));
  return { studio, root };
}
test('source desktop launch selects the declared external build independent of current directory', () => {
  const { studio, root } = fixture(), built = desktopBuildDirectory(root);
  assert.equal(built, join(studio, 'local/build/slowtune/desktop'));
  for (const file of ['dist/client/index.html', 'dist/server/index.js', 'dist/server/config.js']) { mkdirSync(dirname(join(built, file)), { recursive: true }); writeFileSync(join(built, file), 'fixture'); }
  const options = desktopLaunchOptions(root, { MUSIC_APP_CONFIG: join(studio, '../instances/slowtune/config.local.json') });
  assert.equal(options.serviceRoot, built); assert.equal(options.env.MUSIC_APP_DESKTOP_ROOT, built);
  assert.equal(assertDesktopBuildDirectory(built, root), built);
});
test('a declared source refuses an incomplete external build even if the old source dist exists', () => {
  const { root } = fixture();
  for (const file of ['dist/client/index.html', 'dist/server/index.js', 'dist/server/config.js']) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), 'old fixture'); }
  assert.throws(() => desktopLaunchOptions(root, {}), /桌面构建不完整/);
});
test('build cleaning rejects a wrong target, instance directory, and linked build parent', () => {
  const { studio, root } = fixture(), built = desktopBuildDirectory(root);
  assert.throws(() => assertDesktopBuildDirectory(root, root), /不一致/);
  const file = join(root, 'workspace.paths.json');
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, project: 'slowtune', paths: { studio: '../..', build: '../../../instances/slowtune', artifacts: '../../local/artifacts/slowtune', testRuntime: '../../local/runtime/slowtune' } }));
  assert.throws(() => desktopBuildDirectory(root), /超出/);
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, project: 'slowtune', paths: { studio: '../..', build: '../../local/build/slowtune', artifacts: '../../local/artifacts/slowtune', testRuntime: '../../local/runtime/slowtune' } }));
  mkdirSync(join(studio, 'local/build'), { recursive: true }); mkdirSync(join(studio, 'private'));
  symlinkSync(join(studio, 'private'), dirname(built), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assertDesktopBuildDirectory(built, root), /目录链接/);
});
test('build cleaning also rejects a dangling directory link', () => {
  const { studio, root } = fixture(), built = desktopBuildDirectory(root);
  mkdirSync(join(studio, 'local/build'), { recursive: true });
  symlinkSync(join(studio, 'missing'), dirname(built), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assertDesktopBuildDirectory(built, root), /目录链接/);
});
