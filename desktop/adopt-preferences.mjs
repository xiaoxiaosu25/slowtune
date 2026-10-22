// One-time adoption helper. It reads a copied Electron profile without contacting
// the old service or any upstream site, and never prints the saved preferences.
import { app, BrowserWindow, session } from 'electron';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const data = resolve(process.env.SLOWTUNE_ADOPT_DATA), origin = new URL(process.env.SLOWTUNE_ADOPT_ORIGIN).origin;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('Invalid adoption origin');
app.setPath('userData', join(data, 'profile'));
void app.whenReady().then(async () => { try {
  const profile = session.fromPartition('persist:slowtune-player');
  profile.protocol.handle('http', request => new Response(new URL(request.url).origin === origin ? '<!doctype html><title>SlowTune adoption</title>' : '', { status: new URL(request.url).origin === origin ? 200 : 403, headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'" } }));
  const window = new BrowserWindow({ show: false, webPreferences: { session: profile, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(origin + '/');
  const values = await window.webContents.executeJavaScript("Object.fromEntries(Object.keys(localStorage).filter(key => /^slow-listening:[\\w:%.-]{1,500}$/.test(key)).map(key => [key, localStorage.getItem(key)]))");
  writeFileSync(join(data, 'adopted-preferences.json'), JSON.stringify(values) + '\n', { mode: 0o600 });
  await profile.flushStorageData(); window.destroy();
  app.exit(0);
} catch { app.exit(1); } });
