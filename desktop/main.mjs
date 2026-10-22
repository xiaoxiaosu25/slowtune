import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog, shell, screen, powerMonitor, nativeTheme, clipboard } from 'electron';
import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { preferences, restoreLyricsPreferences, windowAppearance, fitBounds, lyricDocument, lyricClock, hasDisplayableLyrics, playbackCommands } from './model.mjs';
import { iconPng } from './icon.mjs';
import { serveDesktopLifecycle, desktopDataDirectory } from './lifecycle.mjs';
import { prepareLocalProfile, localProfilePath, requiresLegacyProfileAdoption } from './profile.mjs';
import { DesktopStorage, DesktopState, DesktopFile } from './storage.mjs';

const run = promisify(execFile), here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(here, '..');
const serviceRoot = app.isPackaged ? join(process.resourcesPath, 'service') : resolve(process.env.MUSIC_APP_DESKTOP_ROOT ?? sourceRoot);
const dataDirectory = desktopDataDirectory(process.env, app.isPackaged ? dirname(app.getPath('exe')) : sourceRoot);
app.setName('SlowTune');
if (process.platform === 'win32') app.setAppUserModelId('studio.slowtune.desktop');
app.setPath('userData', join(dataDirectory, 'profile'));
app.setAppLogsPath(join(dataDirectory, 'logs'));
app.commandLine.appendSwitch('disk-cache-dir', join(dataDirectory, 'cache'));
if (!app.requestSingleInstanceLock()) app.quit();
else void start().catch(error => { dialog.showErrorBox('慢听桌面启动失败', error.message); app.exit(1); });

async function start() {
  let player, overlay, tray, quitting = false, quitComplete = false, starting = false, base = '', connection, storage, allowedPage = '';
  let document = null, clock = null, pendingConfig = '', activeRuntime = '', activeService, attemptedConfig = '', released, sessionConnection;
  let welcomeLoaded = Promise.resolve(), welcomeShownAt = 0, welcomeWait = new AbortController();
  let welcomeDisplayed = Promise.resolve(), markWelcomeDisplayed;
  let stateStorage, stateReadError, exitRecovery = false, releaseRequested = false, playerReleased = false, quitStage = '';
  const preferenceState = () => {
    const states = [storage, stateStorage, welcomeStorage].filter(Boolean).map(item => item.state());
    return { pending: states.some(item => item.pending), error: states.find(item => item.error)?.error ?? null };
  };
  const notifyPersistence = () => send(player, 'desktop:preference-state', preferenceState());
  const welcomeStorage = new DesktopFile(join(dataDirectory, 'welcome.json'), { onState: notifyPersistence });
  let saved = {};
  try { stateStorage = new DesktopState(dataDirectory, { onState: notifyPersistence }); saved = stateStorage.read(); }
  catch (error) { stateReadError = error; }
  let prefs = restoreLyricsPreferences(saved), status = { phase: 'starting', message: '正在准备你的音乐…' };
  let optionsOpen = false, unlockInteractive = false, unlockTarget, unlockWatch, optionsBounds;
  saved.lyricsDefaultsVersion = 1;
  let appearance = { theme: saved.windowTheme === 'dark' || saved.windowTheme !== 'light' && nativeTheme.shouldUseDarkColors ? 'dark' : 'light', mode: 'welcome' };
  const icon = nativeImage.createFromBuffer(iconPng());
  const fileURL = name => pathToFileURL(join(here, name)).href;
  const valid = (event, window, url) => !!window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === url;
  const fromPlayer = event => valid(event, player, base + '/');
  const fromOverlay = event => valid(event, overlay, fileURL('lyrics.html'));
  const fromSetup = event => valid(event, player, fileURL('setup.html'));
  const send = (window, channel, value) => { if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, value); };
  const state = () => ({ preferences: prefs, document, clock });
  const saveSoon = () => {
    if (!stateStorage) return;
    // Failure is retained by the writer and reported through preference-state.
    void stateStorage.writeSnapshot({ ...saved, lyrics: prefs }).catch(() => {});
  };
  async function flushFiles() {
    // Attempt every file even if one fails; keep all pending values for retry.
    const results = await Promise.allSettled([storage?.flush(), stateStorage?.flush(), welcomeStorage.flush()]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
  const colors = theme => theme === 'dark' ? { background: '#1b1916', foreground: '#f2ece1' } : { background: '#f3f0e9', foreground: '#252720' };
  const chrome = (theme, mode) => ({ height: 40, color: mode === 'standard' ? colors(theme).background : '#00000000', symbolColor: mode === 'welcome-artwork' ? '#ffffff' : colors(theme).foreground });
  function applyWindowAppearance() {
    if (!player || player.isDestroyed()) return;
    player.setTitleBarOverlay(chrome(appearance.theme, appearance.mode));
    player.setBackgroundColor(colors(appearance.theme).background);
    nativeTheme.themeSource = appearance.theme;
    send(player, 'desktop:window-state', { fullscreen: player.isFullScreen() });
  }
  function showPlayer() {
    const target = player;
    if (!target || target.isDestroyed()) return;
    if (target.isMinimized()) target.restore(); target.show(); target.focus();
  }
  function broadcast() { for (const window of [player, overlay]) send(window, 'desktop:state', state()); }
  async function releasePlayer() {
    if (!player || player.isDestroyed() || player.webContents.getURL() !== base + '/') return;
    let timer;
    try {
      const ok = await Promise.race([new Promise(done => { released = done; send(player, 'desktop:command', 'release'); }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('播放器释放未在规定时间内确认。')), 2500); })]);
      if (!ok) throw new Error('播放器释放失败。');
    } finally { clearTimeout(timer); released = undefined; }
  }
  function safeExternal(url) { try { const value = new URL(url); if (['http:', 'https:'].includes(value.protocol)) void shell.openExternal(value.href).catch(() => {}); } catch { /* reject non-web protocols */ } }
  function secureWindow(window, allowed) {
    window.webContents.setWindowOpenHandler(({ url }) => { safeExternal(url); return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, url) => { if (url !== allowed()) { event.preventDefault(); safeExternal(url); } });
    window.webContents.on('will-redirect', (event, url) => { if (url !== allowed()) event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
  }
  function boundsFor(savedBounds, minimum, fallback) {
    const displays = screen.getAllDisplays(), matching = savedBounds && displays.find(({ workArea: area }) => savedBounds.x + savedBounds.width > area.x && savedBounds.x < area.x + area.width && savedBounds.y + savedBounds.height > area.y && savedBounds.y < area.y + area.height);
    return fitBounds(savedBounds, (matching ?? screen.getPrimaryDisplay()).workArea, minimum, fallback);
  }
  function clearUnlockTarget() {
    clearInterval(unlockWatch); unlockWatch = undefined; unlockTarget = undefined; unlockInteractive = false;
  }
  const shouldShowLyrics = () => prefs.visible && hasDisplayableLyrics(document);
  function checkUnlockPointer() {
    if (!overlay || overlay.isDestroyed()) { clearUnlockTarget(); return; }
    const bounds = overlay.getContentBounds(), cursor = screen.getCursorScreenPoint();
    const x = cursor.x - bounds.x, y = cursor.y - bounds.y;
    const next = prefs.locked && shouldShowLyrics() && !!unlockTarget && x >= unlockTarget.x && x < unlockTarget.x + unlockTarget.width && y >= unlockTarget.y && y < unlockTarget.y + unlockTarget.height;
    if (next !== unlockInteractive) {
      unlockInteractive = next;
      overlay.setIgnoreMouseEvents(prefs.locked && !unlockInteractive, { forward: true });
    }
    if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) send(overlay, 'desktop:lyrics-pointer-left');
  }
  function applyOverlay() {
    if (!overlay || overlay.isDestroyed()) return;
    const visible = shouldShowLyrics();
    if (!visible) {
      clearUnlockTarget();
      if (optionsOpen) { const compact = compactOverlayBounds(); optionsOpen = false; sizeOverlay(compact); }
    }
    overlay.setIgnoreMouseEvents(prefs.locked && !unlockInteractive, { forward: true });
    const focusChanged = overlay.isFocusable() !== !prefs.locked;
    if (focusChanged) overlay.setFocusable(!prefs.locked);
    // On Windows setFocusable also changes taskbar visibility; keep lyrics hidden.
    overlay.setSkipTaskbar(true);
    // Electron's default "floating" level moves Windows windows behind the
    // taskbar HWND. If that HWND is not topmost, this also clears WS_EX_TOPMOST.
    if (focusChanged || !overlay.isAlwaysOnTop()) overlay.setAlwaysOnTop(true, process.platform === 'win32' ? 'pop-up-menu' : 'floating');
    // Content availability controls this window, while the saved preference
    // continues to record whether the user enabled desktop lyrics.
    if (visible) overlay.showInactive(); else overlay.hide();
  }
  const lyricHeight = () => Math.max(170, Math.ceil(prefs.fontSize * (prefs.lines === 2 ? 2.6 : 1.6) + 66));
  function compactOverlayBounds() {
    const bounds = overlay.getBounds(), height = lyricHeight();
    // Expanded windows can be clamped at a screen edge. Keep the compact anchor
    // separate, applying only actual dragging after the expansion.
    if (optionsBounds) return { ...optionsBounds.compact, x: optionsBounds.compact.x + bounds.x - optionsBounds.window.x, y: optionsBounds.compact.y + bounds.y - optionsBounds.window.y };
    return { ...bounds, height, y: bounds.y + bounds.height - height };
  }
  function sizeOverlay(compact = compactOverlayBounds()) {
    const compactHeight = lyricHeight();
    const nextCompact = boundsFor({ ...compact, height: compactHeight, y: compact.y + compact.height - compactHeight }, { width: 420, height: 150 }, { width: 920, height: compactHeight });
    const height = compactHeight + (optionsOpen ? 320 : 0);
    const bounds = optionsOpen ? boundsFor({ ...nextCompact, height, y: nextCompact.y + compactHeight - height }, { width: 420, height: 150 }, { width: 920, height }) : nextCompact;
    optionsBounds = optionsOpen ? { compact: nextCompact, window: bounds } : undefined;
    overlay.setBounds(bounds);
    saved.overlayBounds = compactOverlayBounds();
  }
  function updatePreferences(input) {
    const previous = prefs, compact = overlay && compactOverlayBounds();
    prefs = preferences(input, prefs);
    if (previous.locked !== prefs.locked || !prefs.visible || previous.fontSize !== prefs.fontSize || previous.lines !== prefs.lines) clearUnlockTarget();
    const closeOptions = optionsOpen && (prefs.locked || !prefs.visible);
    if (closeOptions) optionsOpen = false;
    if (prefs.visible && !overlay) createOverlay();
    if (compact && (closeOptions || previous.fontSize !== prefs.fontSize || previous.lines !== prefs.lines)) sizeOverlay(compact);
    applyOverlay(); saveSoon(); broadcast(); updateMenu();
    return state();
  }
  function updateMenu() {
    const items = [
      { label: '打开慢听', click: showPlayer },
      { label: '桌面歌词', type: 'checkbox', checked: prefs.visible, enabled: !!stateStorage && !exitRecovery && !quitting, click: item => updatePreferences({ visible: item.checked }) },
      ...(prefs.locked ? [{ label: '解锁歌词（恢复鼠标操作）', enabled: prefs.visible && !exitRecovery && !quitting, click: () => updatePreferences({ locked: false }) }] : []),
      { label: '重置歌词位置', enabled: !!stateStorage && !exitRecovery && !quitting, click: resetLyricsPosition },
      { type: 'separator' },
      { label: '退出慢听', click: () => app.quit() },
    ];
    tray?.setContextMenu(Menu.buildFromTemplate(items));
    Menu.setApplicationMenu(null);
    if (player && !player.isDestroyed()) player.removeMenu();
  }
  function resetLyricsPosition() {
    saved.overlayBounds = undefined;
    if (overlay) {
      const height = lyricHeight();
      sizeOverlay(boundsFor(undefined, { width: 420, height: 150 }, { width: 920, height }));
    }
    saveSoon();
  }
  async function stopCurrentService() {
    if (!activeRuntime || !attemptedConfig) return;
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
    // Failed starts can still own a pending process. The optional mode skips
    // unrelated instances but propagates cleanup failures for our own startup.
    await run(activeRuntime, [app.isPackaged ? join(serviceRoot, 'desktop-service.mjs') : join(here, 'service.mjs'), serviceRoot, attemptedConfig, activeService ? '--stop' : '--stop-if-owned', ...(activeService ? [String(activeService.pid)] : [])], { cwd: serviceRoot, env, windowsHide: true, timeout: 75000, maxBuffer: 65536 });
    activeService = undefined; attemptedConfig = '';
  }
  function createOverlay() {
    const height = lyricHeight();
    overlay = new BrowserWindow({ ...boundsFor(saved.overlayBounds ? { ...saved.overlayBounds, height } : undefined, { width: 420, height: 150 }, { width: 920, height }), title: '慢听 · 桌面歌词', show: false, transparent: true, frame: false, resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      webPreferences: { preload: join(here, 'lyrics-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false, partition: 'slowtune-lyrics' } });
    overlay.setAlwaysOnTop(true, process.platform === 'win32' ? 'pop-up-menu' : 'floating');
    secureWindow(overlay, () => fileURL('lyrics.html'));
    overlay.on('move', () => { saved.overlayBounds = compactOverlayBounds(); saveSoon(); });
    overlay.on('close', event => { if (!quitting) { event.preventDefault(); updatePreferences({ visible: false }); } });
    overlay.webContents.on('did-start-loading', () => { clearUnlockTarget(); applyOverlay(); });
    overlay.webContents.on('render-process-gone', () => { clearUnlockTarget(); applyOverlay(); });
    overlay.webContents.on('did-finish-load', () => { broadcast(); applyOverlay(); });
    applyOverlay();
    void overlay.loadFile(join(here, 'lyrics.html'));
  }
  async function restoreLocalSession(configFile = pendingConfig) {
    if (quitting || !activeService || !configFile || resolve(configFile) !== resolve(localProfilePath(dataDirectory))) return false;
    if (sessionConnection) return sessionConnection;
    const owner = activeService, target = player, origin = base;
    sessionConnection = (async () => {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
      const entry = app.isPackaged ? join(serviceRoot, 'desktop-service.mjs') : join(here, 'service.mjs');
      const result = await run(activeRuntime, [entry, serviceRoot, configFile, '--session', String(owner.pid)], { cwd: serviceRoot, env, windowsHide: true, timeout: 15000, maxBuffer: 65536 });
      const session = JSON.parse(result.stdout.trim());
      if (session.url !== origin || !/^[\w-]{43}$/.test(session.cookie) || activeService !== owner || player !== target || !target || target.isDestroyed()) throw new Error('本机音乐空间已变化，请重新打开。');
      await target.webContents.session.cookies.set({ url: origin + '/', name: 'music_session', value: session.cookie, path: '/', httpOnly: true, sameSite: 'strict', secure: false, expirationDate: Date.now() / 1000 + 7 * 86400 });
      return true;
    })().finally(() => { sessionConnection = undefined; });
    return sessionConnection;
  }
  function createPlayer() {
    allowedPage = '';
    const bounds = boundsFor(saved.windowBounds, { width: 1000, height: 640 }, { width: 1360, height: 860 });
    appearance = { ...appearance, mode: 'welcome' };
    player = new BrowserWindow({ ...bounds, minWidth: 1000, minHeight: 640, title: '慢听 SlowTune', icon, backgroundColor: colors(appearance.theme).background, show: false, titleBarStyle: 'hidden', titleBarOverlay: chrome(appearance.theme, appearance.mode),
      webPreferences: { preload: join(here, 'player-preload.cjs'), partition: 'persist:slowtune-player', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false } });
    secureWindow(player, () => allowedPage);
    player.removeMenu();
    player.on('enter-full-screen', applyWindowAppearance); player.on('leave-full-screen', applyWindowAppearance);
    const remember = () => { if (!player.isDestroyed() && !player.isMinimized() && !player.isMaximized() && !player.isFullScreen()) { saved.windowBounds = player.getBounds(); saveSoon(); } };
    player.on('move', remember); player.on('resize', remember);
    player.on('close', event => { if (!quitComplete) { event.preventDefault(); app.quit(); } });
    player.webContents.on('did-start-loading', () => { document = clock = null; applyOverlay(); broadcast(); });
    player.webContents.on('render-process-gone', () => { document = clock = null; allowedPage = ''; applyOverlay(); broadcast(); openSetup('error', '播放页面意外退出。可重试打开，服务和已保存资料仍保留。'); });
  }
  async function openPlayer(url, configFile) {
    base = new URL(url).origin;
    try {
      // A persistent Electron profile can reuse fresh cached HTML that points
      // at an older bundle, even after the backend and disk build were replaced.
      // Only clear HTTP resources; retain login cookies and local preferences.
      await restoreLocalSession(configFile);
      await player.webContents.session.clearCache();
      await welcomeLoaded;
      await welcomeDisplayed;
      // The renderer confirms its artwork and entrance animation are visible.
      await delay(Math.max(0, 2000 - (performance.now() - welcomeShownAt)), undefined, { signal: welcomeWait.signal });
      if (quitting) return;
      allowedPage = base + '/';
      await player.loadURL(base + '/');
    }
    catch { if (quitting) return; throw new Error('播放页面加载失败，请重试打开慢听。'); }
    delete saved.configFile; saveSoon(); status = { phase: 'ready', message: '' };
    if (quitting) return;
    player.show(); if (prefs.visible && !overlay) createOverlay(); applyOverlay(); broadcast(); updateMenu();
  }
  const setupState = () => {
    let welcome;
    try { welcome = JSON.parse(readFileSync(join(dataDirectory, 'welcome.json'), 'utf8')); } catch {}
    if (!welcome?.image) { try { welcome = { ...welcome, image: 'data:image/png;base64,' + readFileSync(join(serviceRoot, 'dist/client/assets/coast.png')).toString('base64') }; } catch {} }
    return { ...status, retryLabel: exitRecovery ? '重试保存并退出' : '重试', theme: appearance.theme, welcome };
  };
  function openSetup(phase = 'starting', message = '') {
    status = { ...status, phase, message };
    if (phase === 'starting') {
      welcomeWait.abort(); welcomeWait = new AbortController(); welcomeShownAt = 0;
      welcomeDisplayed = new Promise(done => {
        markWelcomeDisplayed = () => { if (!welcomeShownAt) { welcomeShownAt = performance.now(); done(); } };
        welcomeWait.signal.addEventListener('abort', done, { once: true });
      });
    }
    if (!player || player.isDestroyed()) createPlayer();
    const welcome = setupState().welcome;
    appearance = { ...appearance, mode: welcome?.image && welcome.settings?.background !== 'plain' ? 'welcome-artwork' : 'welcome' };
    applyWindowAppearance();
    if (allowedPage !== fileURL('setup.html')) {
      allowedPage = fileURL('setup.html');
      welcomeLoaded = player.loadFile(join(here, 'setup.html')).catch(error => { if (!quitting) dialog.showErrorBox('慢听启动失败', error.message); });
    } else send(player, 'desktop:setup-state', setupState());
    showPlayer();
    updateMenu();
  }
  function connect() {
    if (starting || quitting || exitRecovery) return;
    if (stateReadError) {
      try {
        stateStorage = new DesktopState(dataDirectory, { onState: notifyPersistence });
        saved = stateStorage.read(); prefs = restoreLyricsPreferences(saved); saved.lyricsDefaultsVersion = 1;
        appearance.theme = saved.windowTheme === 'dark' || saved.windowTheme !== 'light' && nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
        if (player && !player.isDestroyed()) player.setBounds(boundsFor(saved.windowBounds, { width: 1000, height: 640 }, { width: 1360, height: 860 }));
        stateReadError = undefined;
      } catch (error) { stateReadError = error; openSetup('error', error.message); return; }
    }
    starting = true; openSetup('starting', '正在准备你的音乐…');
    connection = startConnection().finally(() => { starting = false; });
    return connection;
  }
  async function startConnection() {
    try {
      await stopCurrentService();
      mkdirSync(join(dataDirectory, 'logs'), { recursive: true });
      if (requiresLegacyProfileAdoption({ packaged: app.isPackaged, dataOverride: !!process.env.MUSIC_APP_DESKTOP_DATA, data: dataDirectory, legacyData: join(app.getPath('appData'), 'SlowTune') })) throw new Error('原桌面资料尚未接入，未创建空资料。开发环境请先执行 npm run desktop:adopt。');
      pendingConfig = await prepareLocalProfile(dataDirectory);
      if (storage) await storage.flush();
      storage = new DesktopStorage(dataDirectory, { onState: () => send(player, 'desktop:preference-state', preferenceState()) });
      const file = pendingConfig;
      let runtime = app.isPackaged ? join(process.resourcesPath, 'runtime', 'node.exe') : process.env.MUSIC_APP_NODE;
      if (!runtime) { const result = await run('node.exe', ['-p', 'process.execPath'], { windowsHide: true, timeout: 10000 }); runtime = result.stdout.trim(); }
      if (!runtime || !existsSync(runtime)) throw new Error('未找到兼容的 Node 运行时。源码运行请使用 npm run desktop，免安装包请完整解压后打开。');
      activeRuntime = runtime;
      attemptedConfig = file;
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
      const serviceEntry = app.isPackaged ? join(serviceRoot, 'desktop-service.mjs') : join(here, 'service.mjs');
      const result = await run(runtime, [serviceEntry, serviceRoot, file, '--local'], { cwd: serviceRoot, env, windowsHide: true, timeout: 120000, maxBuffer: 131072 }).catch(error => { throw new Error(error.stderr?.split(/\r?\n/).filter(line => line && !line.startsWith('(node:') && !line.includes('--trace-warnings')).at(-1) || '本地音乐引擎启动失败，请重试或查看日志。'); });
      const ready = JSON.parse(result.stdout.trim());
      if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(ready.url) || ready.configFile !== resolve(file) || !Number.isInteger(ready.pid) || ready.pid <= 0) throw new Error('服务返回的桌面地址无效。');
      activeService = ready;
      if (!quitting) await openPlayer(ready.url, file);
    } catch (error) {
      try { appendFileSync(join(dataDirectory, 'logs/desktop-launch.log'), `${new Date().toISOString()} ${error.message}\n`, { mode: 0o600 }); } catch {}
      if (!quitting) openSetup('error', error.message);
    }
  }
  ipcMain.on('desktop:appearance', (event, input) => {
    if (!fromPlayer(event)) return;
    const next = windowAppearance(input); if (!next) return;
    appearance = next; saved.windowTheme = next.theme; applyWindowAppearance(); saveSoon();
  });
  ipcMain.handle('desktop:read-preferences', event => { if (!fromPlayer(event) || !storage) throw new Error('无效的窗口身份'); return storage.read(); });
  ipcMain.handle('desktop:write-preference', (event, key, value) => {
    if (!fromPlayer(event) || !storage) throw new Error('无效的窗口身份');
    return storage.write(key, value);
  });
  ipcMain.handle('desktop:flush-preferences', async event => {
    if (!fromPlayer(event) || !storage) throw new Error('无效的窗口身份');
    try { await flushFiles(); } catch { throw new Error('本地设置保存失败，请检查磁盘空间和资料目录权限后重试。'); }
  });
  ipcMain.handle('desktop:runtime-info', event => {
    if (!fromPlayer(event)) throw new Error('无效的窗口身份');
    return { appVersion: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node, platform: process.platform, arch: process.arch, preferences: preferenceState() };
  });
  ipcMain.handle('desktop:copy-diagnostics', (event, text) => {
    if (!fromPlayer(event) || typeof text !== 'string' || text.length > 8192) throw new Error('无效的诊断信息');
    clipboard.writeText(text);
  });
  ipcMain.handle('desktop:data-directory', event => { if (!fromPlayer(event)) throw new Error('无效的窗口身份'); return dataDirectory; });
  ipcMain.handle('desktop:open-directory', async (event, kind) => {
    if (!fromPlayer(event) && !fromSetup(event) || !['data', 'logs'].includes(kind)) throw new Error('无效的窗口操作');
    const directory = kind === 'logs' ? join(dataDirectory, 'logs') : dataDirectory;
    mkdirSync(directory, { recursive: true }); const issue = await shell.openPath(directory); if (issue) throw new Error(issue);
  });
  ipcMain.handle('desktop:save-welcome', (event, value) => {
    if (!fromPlayer(event) || !value || !['builtin', 'custom', 'plain'].includes(value.settings?.background) || !['left', 'center', 'right'].includes(value.settings?.position) || ![value.settings?.desktopFocus?.x, value.settings?.desktopFocus?.y, value.settings?.shade].every(n => Number.isFinite(n) && n >= 0 && n <= 100) || value.image !== undefined && (typeof value.image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.image) || value.image.length > 5 * 1024 * 1024)) throw new Error('无效的欢迎图');
    return welcomeStorage.writeSnapshot({ settings: { background: value.settings.background, position: value.settings.position, desktopFocus: value.settings.desktopFocus, shade: value.settings.shade }, image: value.image });
  });
  ipcMain.handle('desktop:reset-lyrics-position', event => { if (!fromPlayer(event) && !fromOverlay(event)) throw new Error('无效的窗口身份'); resetLyricsPosition(); });
  ipcMain.handle('desktop:lyrics-options', (event, open) => {
    if (!fromOverlay(event) || typeof open !== 'boolean') throw new Error('无效的窗口操作');
    const compact = compactOverlayBounds(); optionsOpen = open && !prefs.locked && shouldShowLyrics(); sizeOverlay(compact);
  });
  ipcMain.on('desktop:lyrics-unlock-target', (event, target) => {
    if (!fromOverlay(event)) return;
    if (target === null) {
      const wasInteractive = unlockInteractive; clearUnlockTarget();
      if (wasInteractive) overlay.setIgnoreMouseEvents(prefs.locked, { forward: true });
      return;
    }
    const [width, height] = overlay.getContentSize();
    if (!prefs.locked || !shouldShowLyrics() || !target || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(target[key])) || target.x < 0 || target.y < 0 || target.width <= 0 || target.height <= 0 || target.width > 48 || target.height > 48 || target.x + target.width > width || target.y + target.height > height) return;
    unlockTarget = { x: target.x, y: target.y, width: target.width, height: target.height };
    // Native cursor checks survive synthesized mouseleave and jumps outside the
    // window. Run only while a visible unlock control needs a hit target.
    if (!unlockWatch) { unlockWatch = setInterval(checkUnlockPointer, 50); unlockWatch.unref(); }
    checkUnlockPointer();
  });
  ipcMain.handle('desktop:state', event => { if (fromPlayer(event) || fromOverlay(event)) return state(); throw new Error('无效的窗口身份'); });
  ipcMain.handle('desktop:restore-local-session', event => { if (!fromPlayer(event)) throw new Error('无效的窗口身份'); return restoreLocalSession(); });
  ipcMain.handle('desktop:preferences', (event, input) => {
    if (fromOverlay(event) || fromPlayer(event)) return updatePreferences(input);
    throw new Error('无效的窗口操作');
  });
  ipcMain.on('desktop:document', (event, input) => {
    if (!fromPlayer(event)) return;
    const next = lyricDocument(input); if (!next) return;
    if (document?.sourceKey !== next.sourceKey) clock = null;
    document = next; send(overlay, 'desktop:document', document); applyOverlay();
  });
  ipcMain.on('desktop:clock', (event, input) => {
    if (!fromPlayer(event)) return;
    const next = lyricClock(input); if (!next || next.sourceKey !== document?.sourceKey) return;
    clock = next; if (prefs.visible) send(overlay, 'desktop:clock', clock);
  });
  ipcMain.on('desktop:command', (event, command) => { if (fromOverlay(event) && playbackCommands.has(command)) send(player, 'desktop:command', command); });
  ipcMain.on('desktop:show-player', event => { if (fromOverlay(event)) showPlayer(); });
  ipcMain.on('desktop:open-lyrics-settings', event => { if (fromOverlay(event)) { showPlayer(); send(player, 'desktop:open-lyrics-settings'); } });
  ipcMain.on('desktop:released', (event, ok) => { if (fromPlayer(event) && typeof ok === 'boolean') released?.(ok); });
  ipcMain.handle('desktop:setup-state', event => { if (fromSetup(event)) return setupState(); throw new Error('无效的窗口身份'); });
  ipcMain.on('desktop:setup-visible', event => { if (fromSetup(event) && status.phase === 'starting' && player.isVisible() && !player.isMinimized()) markWelcomeDisplayed?.(); });
  ipcMain.handle('desktop:setup-retry', event => { if (fromSetup(event)) { if (exitRecovery) app.quit(); else return connect(); } });
  ipcMain.on('desktop:setup-quit', event => { if (fromSetup(event)) app.quit(); });
  ipcMain.on('desktop:quit', event => { if (fromPlayer(event) || fromSetup(event)) app.quit(); });
  app.on('second-instance', showPlayer); app.on('activate', showPlayer);
  app.on('before-quit', event => {
    if (quitComplete) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true; welcomeWait.abort(); tray?.setToolTip('慢听 · 正在保存并退出…'); updateMenu();
    void (async () => {
      await connection;
      quitStage = '释放播放器前保存';
      saveSoon(); await flushFiles();
      if (!releaseRequested) {
        quitStage = '释放播放器';
        releaseRequested = !!player && !player.isDestroyed() && player.webContents.getURL() === base + '/';
        await releasePlayer(); playerReleased = releaseRequested;
      }
      quitStage = '释放播放器后保存';
      if (releaseRequested) {
        exitRecovery = true; document = clock = null; applyOverlay(); broadcast();
        openSetup('stopping', '正在完成保存并关闭内部服务…');
        await welcomeLoaded;
      }
      await flushFiles();
      document = clock = null; applyOverlay(); broadcast();
      quitStage = '停止内部服务';
      await stopCurrentService();
      quitStage = '内部服务停止后保存';
      await flushFiles();
      quitComplete = true; clearUnlockTarget();
      overlay?.destroy(); player?.destroy(); tray?.destroy(); app.quit();
    })().catch(error => {
      quitting = false; tray?.setToolTip('慢听 · 退出未完成');
      const persistence = preferenceState().pending ? '本地设置尚未保存，最新修改仍保留在内存中。请检查磁盘空间和资料目录权限。' : '请检查日志及本应用内部服务的状态。';
      const normalPlayer = player && !player.isDestroyed() && player.webContents.getURL() === base + '/';
      const message = `退出在“${quitStage}”阶段失败。${playerReleased ? '播放器已释放；' : releaseRequested ? '播放器已停用，释放尚未确认；' : '播放器尚未释放；'}${attemptedConfig ? '内部服务停止尚未确认。' : '内部服务已停止或尚未启动。'}${persistence}`;
      if (releaseRequested || !normalPlayer || exitRecovery || quitStage === '停止内部服务' || quitStage === '内部服务停止后保存') {
        exitRecovery = true; document = clock = null; applyOverlay(); broadcast();
        openSetup('error', message + '点击“重试保存并退出”继续退出；退出完成后可重新打开慢听。');
      } else { showPlayer(); updateMenu(); }
      dialog.showErrorBox('慢听尚未退出', message + (exitRecovery ? '请使用恢复页的“重试保存并退出”。' : '请点击“重试保存偏好”后再次退出。'));
      try { appendFileSync(join(dataDirectory, 'logs/desktop-launch.log'), `${new Date().toISOString()} ${quitStage}: ${error.stderr?.trim() || error.message}\n`, { mode: 0o600 }); } catch {}
    });
  });
  await app.whenReady();
  if (!app.isPackaged) {
    const closeLifecycle = await serveDesktopLifecycle({
      data: dataDirectory, sourceRoot, launchToken: process.env.MUSIC_APP_LAUNCH_TOKEN || '',
      status: () => ({ phase: quitting ? 'stopping' : starting ? 'starting' : status.phase, message: status.message }),
      stop: () => app.quit(), show: showPlayer,
    });
    app.once('will-quit', closeLifecycle);
  }
  tray = new Tray(icon); tray.setToolTip('慢听 SlowTune'); tray.on('double-click', showPlayer); tray.on('click', showPlayer);
  powerMonitor.on('suspend', () => { send(player, 'desktop:command', 'suspend'); });
  powerMonitor.on('resume', () => { send(player, 'desktop:command', 'resync'); if (prefs.visible) applyOverlay(); });
  screen.on('display-removed', () => { if (overlay) overlay.setBounds(boundsFor(overlay.getBounds(), { width: 420, height: 150 }, { width: 920, height: 190 })); });
  await connect();
}
