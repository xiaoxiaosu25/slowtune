const sleep = ms => new Promise(done => setTimeout(done, ms));
export const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

export async function closeDesktop(application, { mainWindow = false, pid: knownPid } = {}) {
  const wrapper = application.process();
  const pid = knownPid ?? await application.evaluate(() => process.pid);
  const closing = mainWindow
    ? application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('http:')).close()).catch(() => {})
    : application.close().catch(() => {});
  const deadline = Date.now() + 45000;
  while (alive(pid) && Date.now() < deadline) await sleep(100);
  if (alive(pid)) throw new Error('桌面进程未在 45 秒内退出');
  // Playwright may wrap a Windows GUI process in cmd.exe. Only dispose that
  // test wrapper after the real application has finished its own shutdown.
  if (wrapper.pid !== pid) wrapper.kill();
  await Promise.race([closing, sleep(2000)]);
}
