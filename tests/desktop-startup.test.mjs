import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { desktopLaunchOptions } from '../scripts/desktop.mjs';
import { developmentPaths } from '../scripts/workspace-paths.mjs';
import { installInstanceLauncher } from '../scripts/update.mjs';

const project = resolve('.'), output = join(developmentPaths().testRuntime, 'desktop-startup-tests'); mkdirSync(output, { recursive: true });
function fixture() {
  const parent = mkdtempSync(join(output, 'workspace with spaces-')), root = join(parent, 'studio/slowtune'), instance = join(parent, 'instances/slowtune');
  mkdirSync(join(root, 'scripts'), { recursive: true }); mkdirSync(instance, { recursive: true });
  copyFileSync(join(project, '一键启动.cmd'), join(root, '一键启动.cmd'));
  return { parent, root, instance };
}
function build(root) {
  for (const folder of ['dist/client', 'dist/server']) mkdirSync(join(root, folder), { recursive: true });
  for (const file of ['dist/client/index.html', 'dist/server/index.js', 'dist/server/config.js']) writeFileSync(join(root, file), 'fixture');
}
function run(file, cwd, args = [], environment = {}) {
  const env = { ...process.env, ...environment }; if (!Object.hasOwn(environment, 'MUSIC_APP_CONFIG')) delete env.MUSIC_APP_CONFIG;
  return new Promise((done, reject) => {
    const child = spawn('cmd.exe', ['/d', '/c', file, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    const timer = setTimeout(() => { child.kill(); reject(new Error('startup script timeout')); }, 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); done({ code, stdout, stderr, result: stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line)).at(-1) }); });
  });
}

test('desktop ignores server configuration, including a missing explicit selection', () => {
  const { root, instance, parent } = fixture(); build(root); build(join(root, 'local/desktop-build'));
  const file = join(instance, 'config.local.json'); writeFileSync(file, '{}');
  const options = desktopLaunchOptions(root, { ELECTRON_RUN_AS_NODE: '1' });
  assert.equal(options.env.MUSIC_APP_CONFIG, undefined); assert.equal(options.serviceRoot, join(root, 'local/desktop-build')); assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
  const missing = join(parent, 'missing config.json');
  assert.equal(desktopLaunchOptions(root, { MUSIC_APP_CONFIG: missing }).env.MUSIC_APP_CONFIG, undefined);
  const chosen = desktopLaunchOptions(root, { MUSIC_APP_DESKTOP_ROOT: root, MUSIC_APP_CONFIG: file });
  assert.equal(chosen.serviceRoot, root); assert.equal(chosen.env.MUSIC_APP_CONFIG, undefined);
  assert.throws(() => desktopLaunchOptions(root, { MUSIC_APP_DESKTOP_ROOT: join(parent, 'missing build') }), /桌面构建不完整/);
});

test('source and instance desktop entries open desktop while the instance server entry uses its own config from unrelated directories', { timeout: 30000, skip: process.platform !== 'win32' }, async () => {
  const { root, instance, parent } = fixture();
  const capture = kind => `console.log(JSON.stringify({kind:${JSON.stringify(kind)},args:process.argv.slice(2),config:process.env.MUSIC_APP_CONFIG}));`;
  writeFileSync(join(root, 'scripts/desktop.mjs'), capture('desktop')); writeFileSync(join(root, 'scripts/launch.mjs'), capture('service'));
  installInstanceLauncher(instance, root);
  for (const folder of [root, instance]) {
    assert.deepEqual(readdirSync(folder).filter(name => name.endsWith('.cmd')).sort(), (folder === root ? ['一键启动.cmd'] : ['一键启动.cmd', '桌面启动.cmd', '重建并启动桌面.cmd']).sort());
    const result = await run(join(folder, '一键启动.cmd'), parent);
    assert.equal(result.code, 0, result.stderr); assert.equal(result.result.kind, folder === root ? 'desktop' : 'service'); assert.deepEqual(result.result.args, folder === root ? ['--detach'] : []);
    if (folder === instance) assert.equal(result.result.config, join(instance, 'config.local.json'));
  }
  const desktop = await run(join(instance, '桌面启动.cmd'), parent, [], { MUSIC_APP_CONFIG: join(parent, 'unrelated config.json') });
  assert.equal(desktop.code, 0, desktop.stderr); assert.equal(desktop.result.kind, 'desktop'); assert.deepEqual(desktop.result.args, ['--detach']); assert.equal(desktop.result.config, undefined);
  const restart = await run(join(instance, '重建并启动桌面.cmd'), parent, [], { MUSIC_APP_CONFIG: join(parent, 'unrelated config.json') });
  assert.equal(restart.code, 0, restart.stderr); assert.equal(restart.result.kind, 'desktop'); assert.deepEqual(restart.result.args, ['--detach', '--restart']); assert.equal(restart.result.config, undefined);
});

test('instance installer upgrades its former standard entry and refuses custom content before writing', () => {
  const { root, instance, parent } = fixture(); installInstanceLauncher(instance, root);
  const file = join(instance, '一键启动.cmd'), current = readFileSync(file, 'utf8');
  writeFileSync(join(instance, 'start.cmd'), current.replace('\\一键启动.cmd"', '\\start.cmd"'));
  writeFileSync(file, '@echo off\r\ncall "%~dp0start.cmd" %*\r\nexit /b %errorlevel%\r\n');
  installInstanceLauncher(instance, root); assert.equal(readFileSync(file, 'utf8'), current);
  assert.equal(existsSync(join(instance, '桌面启动.cmd')), true);
  assert.equal(existsSync(join(instance, 'start.cmd')), false); assert.equal(existsSync(join(instance, '.launcher-backup')), true);
  installInstanceLauncher(instance, root); assert.equal(readFileSync(file, 'utf8'), current);
  const custom = join(parent, 'custom instance'); mkdirSync(custom); writeFileSync(join(custom, 'start.cmd'), '@echo custom startup\r\n');
  assert.throws(() => installInstanceLauncher(custom, root), /已有自定义内容/);
  assert.equal(existsSync(join(custom, '一键启动.cmd')), false); assert.equal(existsSync(join(custom, 'update.cmd')), false); assert.equal(readFileSync(join(custom, 'start.cmd'), 'utf8'), '@echo custom startup\r\n');
});
