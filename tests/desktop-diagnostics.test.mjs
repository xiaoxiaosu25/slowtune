import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
const bundle = await build({ stdin: { contents: "export * from './src/desktop-diagnostics.ts';", resolveDir: resolve('.') }, bundle: true, platform: 'node', format: 'esm', write: false });
const { desktopDiagnostics } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('diagnostics export only explicit states and version numbers, never raw errors or response extras', () => {
  const secret = 'PRIVATE-cookie-access-control-token', path = 'C:\\Users\\PRIVATE\\data', media = 'https://media.invalid/audio?signature=PRIVATE';
  const text = desktopDiagnostics({ runtime: { appVersion: '0.1.30', electron: '44.9.0', chromium: '152.0.1.2', node: '24.15.0', platform: 'win32', arch: 'x64', preferences: { pending: true, error: 'ENOSPC' }, path }, status: { version: '0.1.30', node: 'v24.15.0', providers: { bilibili: { available: true }, youtube: { enabled: true, available: false, issue: secret + path + media, toolVersion: path } }, build: { stale: false }, delivery: { activeReads: 1, media }, tool: { active: 0 }, cookie: secret }, account: { state: 'authenticated', account: { id: secret, name: path } }, checkedAt: 1, refreshFailed: true, operationError: secret });
  for (const forbidden of [secret, path, media, 'PRIVATE', 'signature=']) assert(!text.includes(forbidden));
  for (const expected of ['0.1.30', '44.9.0', 'Windows · x64', '保留上次信息', 'ENOSPC', '最近操作错误：unknown', 'yt-dlp 版本：未知']) assert(text.includes(expected));
  const missing = desktopDiagnostics({ refreshFailed: false });
  assert(missing.includes('应用版本：未知')); assert(missing.includes('服务 Node.js：未知')); assert(missing.includes('B站接入：未知'));
});
