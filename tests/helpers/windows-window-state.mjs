import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Read the exact HWND supplied by Electron; never change native window state.
export async function windowsWindowState(handle) {
  if (!/^\d+$/.test(handle)) throw new Error('Invalid native window handle');
  const source = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SlowTuneWindowProbe {
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", EntryPoint="FindWindowW", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string title);
}
'@
$windowHandle = [IntPtr]::new([long]${handle})
$windowProcess = [uint32]0
$null = [SlowTuneWindowProbe]::GetWindowThreadProcessId($windowHandle, [ref]$windowProcess)
$extendedStyle = [SlowTuneWindowProbe]::GetWindowLongPtr($windowHandle, -20).ToInt64()
$taskbarHandle = [SlowTuneWindowProbe]::FindWindow('Shell_TrayWnd', $null)
@{ valid=[SlowTuneWindowProbe]::IsWindow($windowHandle); pid=$windowProcess; topmost=($extendedStyle -band 8) -ne 0; visible=[SlowTuneWindowProbe]::IsWindowVisible($windowHandle); minimized=[SlowTuneWindowProbe]::IsIconic($windowHandle); foreground=[SlowTuneWindowProbe]::GetForegroundWindow().ToInt64().ToString(); extendedStyle=$extendedStyle; taskbarExists=$taskbarHandle -ne [IntPtr]::Zero; taskbarTopmost=([SlowTuneWindowProbe]::GetWindowLongPtr($taskbarHandle,-20).ToInt64() -band 8) -ne 0 } | ConvertTo-Json -Compress
`;
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], { windowsHide: true, timeout: 15000 });
  return JSON.parse(stdout.trim());
}

export async function lyricWindowState(application) {
  const electron = await application.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === '慢听 · 桌面歌词');
    const handle = w.getNativeWindowHandle();
    const player = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http:'));
    const playerHandle = player?.getNativeWindowHandle();
    return { pid: process.pid, handle: (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString(), topmost: w.isAlwaysOnTop(), visible: w.isVisible(), focusable: w.isFocusable(), focused: w.isFocused(), player: player ? { handle: (playerHandle.length === 8 ? playerHandle.readBigUInt64LE() : BigInt(playerHandle.readUInt32LE())).toString(), focused: player.isFocused(), minimized: player.isMinimized() } : null };
  });
  return { electron, native: await windowsWindowState(electron.handle) };
}
