import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { desktopBuildDirectory, developmentPaths } from './workspace-paths.mjs';
import { alive, sleep, readState, desktopDataDirectory, desktopRuntimeFile, desktopRequest } from '../desktop/lifecycle.mjs';
import { stopService } from '../desktop/service.mjs';
import { localProfilePath } from '../desktop/profile.mjs';

const productRoot = fileURLToPath(new URL('..', import.meta.url)), run = promisify(execFile);
export function desktopLaunchOptions(root = productRoot, environment = process.env) {
  const built = desktopBuildDirectory(root);
  const serviceRoot = environment.MUSIC_APP_DESKTOP_ROOT ? resolve(environment.MUSIC_APP_DESKTOP_ROOT) : developmentPaths(root).declared || existsSync(join(built, 'dist/server/index.js')) ? built : root;
  if (!['dist/client/index.html', 'dist/server/index.js', 'dist/server/config.js'].every(file => existsSync(join(serviceRoot, file)))) throw new Error('桌面构建不完整，请先运行 npm run desktop:build。');
  const env = { ...environment, MUSIC_APP_NODE: process.execPath, MUSIC_APP_DESKTOP_ROOT: serviceRoot };
  delete env.MUSIC_APP_CONFIG;
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  return { appPath: join(root, 'desktop'), serviceRoot, env };
}

// The OS releases the named pipe when the launcher exits, including crashes.
// Followers receive the same result rather than scheduling another restart.
export async function singleDesktopLaunch(identity, selection, work) {
  const digest = createHash('sha256').update(resolve(identity).toLowerCase()).digest('hex').slice(0, 32);
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\slowtune-launch-${digest}` : join(tmpdir(), `slowtune-launch-${digest}.sock`);
  const clients = new Set(); let outcome;
  const server = createServer(socket => {
    clients.add(socket); socket.setTimeout(5000, () => socket.destroy());
    socket.on('error', () => {}); let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 8192) { socket.destroy(); return; }
      if (!buffer.includes('\n')) return;
      let wanted; try { wanted = JSON.parse(buffer.split('\n')[0]); } catch { socket.destroy(); return; }
      if (wanted.selection !== selection) { socket.end(JSON.stringify({ error: '另一个配置正在启动，请等待完成后再打开此实例。' }) + '\n'); return; }
      socket.setTimeout(0);
      if (outcome) socket.end(JSON.stringify(outcome) + '\n');
    });
    socket.on('close', () => clients.delete(socket));
  });
  try { await new Promise((done, reject) => { server.once('error', reject); server.listen(address, done); }); }
  catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    console.log('已有启动正在进行，正在等待同一次启动完成…');
    return new Promise((done, reject) => {
      const socket = createConnection(address); let buffer = '', completed = false;
      const finish = error => { if (completed) return; completed = true; socket.destroy(); error ? reject(error) : done(); };
      socket.setTimeout(300000, () => finish(new Error('等待当前启动超时，请查看原启动窗口。')));
      socket.on('error', error => finish(error)); socket.on('end', () => { if (!completed) finish(new Error('原启动进程意外结束，请重新启动。')); });
      socket.on('connect', () => socket.write(JSON.stringify({ selection }) + '\n'));
      socket.on('data', chunk => {
        buffer += chunk; if (!buffer.includes('\n')) return;
        try { const result = JSON.parse(buffer.split('\n')[0]); finish(result.error ? new Error(result.error) : undefined); } catch (error) { finish(error); }
      });
    });
  }
  try { await work(); outcome = { ok: true }; }
  catch (error) { outcome = { error: error.message }; throw error; }
  finally {
    for (const socket of clients) socket.end(JSON.stringify(outcome) + '\n');
    await new Promise(done => server.close(done));
  }
}

async function waitForExit(pid) {
  const deadline = Date.now() + 90000;
  while (alive(pid) && Date.now() < deadline) await sleep(150);
  if (alive(pid)) throw new Error('原桌面或服务尚未退出，未构建或启动第二个实例。请查看原窗口及服务日志。');
}

export async function stopDesktopForRestart({ root, data, electron, environment = process.env }) {
  const state = readState(desktopRuntimeFile(data));
  if (alive(state?.pid)) {
    if (resolve(state.sourceRoot ?? '') !== resolve(root)) throw new Error('当前桌面来自另一个源码目录，请先退出该桌面。');
    await desktopRequest(state, 'status');
    await desktopRequest(state, 'stop');
    await waitForExit(state.pid);
    return;
  }
  if (process.platform !== 'win32') return;
  // Compatibility for old desktops without a control endpoint. WM_CLOSE runs
  // their normal release-player / authenticated-stop path; never taskkill.
  const script = `$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class SlowTuneRestartWindows {
  private delegate bool Visitor(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(Visitor visitor, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] private static extern int GetClassName(IntPtr window, StringBuilder name, int length);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  public static bool Close(int pid) {
    bool posted=false;
    EnumWindows((window, parameter) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      if(owner==(uint)pid) {
        var name=new StringBuilder(256); GetClassName(window,name,name.Capacity);
        if(name.ToString()=="Chrome_WidgetWin_1") posted=PostMessage(window,0x0010,IntPtr.Zero,IntPtr.Zero)||posted;
      }
      return true;
    }, IntPtr.Zero);
    return posted;
  }
}
'@
$appArgument='(?:^|\\s)"?'+[regex]::Escape($env:SLOWTUNE_RESTART_APP)+'"?(?:\\s|$)'
$targets=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:SLOWTUNE_RESTART_ELECTRON -and $_.CommandLine -match $appArgument -and $_.CommandLine -notmatch '--type=' })
if($env:SLOWTUNE_RESTART_CUSTOM_DATA -and $targets.Count -gt 0) {
  throw '发现同源码目录的旧桌面，无法确认其是否使用所选自定义资料目录。请先退出该桌面后重试；未停止服务。'
}
foreach($target in $targets) {
  if(Get-Process -Id $target.ProcessId -ErrorAction SilentlyContinue) {
    if(-not [SlowTuneRestartWindows]::Close($target.ProcessId)) { throw '原桌面没有可关闭的窗口，请先退出慢听。' }
    Write-Output $target.ProcessId
  }
}`;
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    // Cold Windows hosts can spend more than 15 seconds initializing CIM and Add-Type.
    env: { ...environment, SLOWTUNE_RESTART_APP: join(root, 'desktop'), SLOWTUNE_RESTART_ELECTRON: electron, SLOWTUNE_RESTART_CUSTOM_DATA: environment.MUSIC_APP_DESKTOP_DATA ? resolve(data) : '' }, windowsHide: true, timeout: 45000, maxBuffer: 65536,
  });
  for (const line of result.stdout.trim().split(/\s+/).filter(Boolean)) { const pid = Number(line); if (Number.isInteger(pid) && pid > 0) await waitForExit(pid); }
}

export async function restartDesktop({ stopDesktop, stopService, build, start, ready, cleanup = async () => {} }) {
  await stopDesktop();
  await stopService();
  await build();
  const child = await start();
  try { await ready(child); }
  catch (error) {
    try { await cleanup(child); }
    catch (cleanupError) { throw new Error(`${error.message}；清理未完成：${cleanupError.message}`); }
    throw error;
  }
  return child;
}

async function waitForDesktop(child, data, token) {
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || !alive(child.pid)) throw new Error('桌面进程意外退出，请查看桌面启动日志。');
    const state = readState(desktopRuntimeFile(data));
    if (state?.pid === child.pid && state.launchToken === token) {
      const detail = await desktopRequest(state, 'status');
      if (['ready', 'error'].includes(detail.phase)) return;
    }
    await sleep(200);
  }
  throw new Error('桌面服务未在预期时间内就绪，请查看桌面启动日志。');
}

export async function launchDesktop({ detached = false, restart = false } = {}) {
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.NODE_OPTIONS;
  // Rebuilding is an explicit development action, never part of ordinary opening.
  delete environment.MUSIC_APP_DESKTOP_ROOT;
  const data = desktopDataDirectory(environment, productRoot);
  const { default: electron } = await import('electron');
  let child;
  await singleDesktopLaunch(data, JSON.stringify([productRoot, restart]), async () => {
    const updating = readState(join(productRoot, 'local/update.lock'));
    if (existsSync(join(productRoot, 'local/update.lock')) && (!updating || !Number.isInteger(updating.pid) || updating.pid <= 0 || alive(updating.pid))) throw new Error('源码实例正在更新，请等待更新完成后再启动。');
    const current = readState(desktopRuntimeFile(data));
    if (!restart && alive(current?.pid)) {
      if (resolve(current.sourceRoot ?? '') !== resolve(productRoot)) throw new Error('此资料目录正在由另一份程序使用。');
      await desktopRequest(current, 'show'); return;
    }
    if (restart) {
      await stopDesktopForRestart({ root: productRoot, data, electron, environment: { ...environment, MUSIC_APP_DESKTOP_DATA: data } });
      const selected = localProfilePath(data), built = desktopBuildDirectory(productRoot);
      if (existsSync(selected) && existsSync(join(built, 'dist/server/config.js'))) await stopService(built, selected, undefined, { optional: true });
      console.log('正在从当前源码重新构建桌面版，请稍候…'); await new Promise((done, reject) => {
        const build = spawn(process.execPath, [join(productRoot, 'scripts/build-desktop.mjs')], { cwd: productRoot, env: environment, windowsHide: true, stdio: 'inherit' });
        build.once('error', reject); build.once('exit', code => code === 0 ? done() : reject(new Error('桌面构建失败，未启动旧版本。')));
      });
    }
    const { appPath, env } = desktopLaunchOptions(productRoot, environment), token = randomUUID();
    env.MUSIC_APP_LAUNCH_TOKEN = token;
    mkdirSync(join(data, 'logs'), { recursive: true });
    const log = detached ? openSync(join(data, 'logs/desktop-launch.log'), 'a') : undefined;
    try {
      // Hiding the GUI process suppresses its first ShowWindow on Windows.
      const launched = spawn(electron, [appPath], { cwd: productRoot, env, detached, windowsHide: false, stdio: detached ? ['ignore', log, log] : 'inherit' });
      await new Promise((done, reject) => { launched.once('error', reject); launched.once('spawn', done); });
      launched.launchToken = token;
      child = launched;
    } finally { if (log !== undefined) closeSync(log); }
    try { await waitForDesktop(child, data, token); console.log('慢听已打开。'); }
    catch (error) { await stopDesktopForRestart({ root: productRoot, data, electron, environment: { ...environment, MUSIC_APP_DESKTOP_DATA: data } }); throw error; }
  });
  if (!child) return 0;
  if (detached) { child.unref(); return 0; }
  if (child.exitCode !== null) return child.exitCode;
  return new Promise(done => child.once('exit', code => done(code ?? 1)));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--detach', '--restart'].includes(arg))) { console.error('仅支持 --detach 和 --restart。'); process.exitCode = 1; }
  else launchDesktop({ detached: args.includes('--detach'), restart: args.includes('--restart') }).then(code => { process.exitCode = code; }).catch(error => { console.error('慢听桌面启动失败：' + (error.stderr?.trim() || error.message)); process.exitCode = 1; });
}
