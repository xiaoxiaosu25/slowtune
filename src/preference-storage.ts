// Browsers retain their own localStorage. Desktop preferences belong to data/,
// independently of the private HTTP port selected for this launch.
let desktopValues: Record<string, string> | undefined;
const sizes = new Map<string, number>();
const encoder = new TextEncoder();
let desktopBytes = 2;
export async function initializePreferenceStorage() {
  if (window.slowTuneDesktop) {
    desktopValues = await window.slowTuneDesktop.readPreferences();
    sizes.clear(); desktopBytes = 2;
    for (const [key, value] of Object.entries(desktopValues)) { const size = entrySize(key, value); sizes.set(key, size); desktopBytes += size; }
  }
}
const entrySize = (key: string, value: string) => encoder.encode(JSON.stringify(key)).length + encoder.encode(JSON.stringify(value)).length + 2;
function write(key: string, value: string | null) {
  if (!/^slow-listening:[\w:%.-]{1,500}$/.test(key) || value !== null && encoder.encode(value).length > 8 * 1024 * 1024) throw new Error('无效的桌面偏好。');
  const size = value === null ? 0 : entrySize(key, value), total = desktopBytes - (sizes.get(key) ?? 0) + size;
  const entries = sizes.size - Number(sizes.has(key)) + Number(value !== null);
  if (total - Number(entries > 0) > 32 * 1024 * 1024) throw new Error('桌面偏好超过保存上限。');
  if (value === null) { delete desktopValues![key]; sizes.delete(key); }
  else { desktopValues![key] = value; sizes.set(key, size); }
  desktopBytes = total;
  void window.slowTuneDesktop!.writePreference(key, value).catch(() => window.dispatchEvent(new Event('desktop-preference-error')));
}
const desktopStorage: Storage = {
  get length() { return Object.keys(desktopValues ?? {}).length; },
  key(index) { return Object.keys(desktopValues ?? {})[index] ?? null; },
  getItem(key) { return desktopValues?.[key] ?? null; },
  setItem(key, value) { write(key, String(value)); },
  removeItem(key) { write(key, null); },
  clear() { for (const key of Object.keys(desktopValues ?? {})) desktopStorage.removeItem(key); },
};
export function preferenceStorage(): Storage {
  if (!window.slowTuneDesktop) return window.localStorage;
  if (!desktopValues) throw new Error('本地偏好尚未准备完成。');
  return desktopStorage;
}
