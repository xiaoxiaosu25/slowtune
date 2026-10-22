import { preferenceStorage } from './preference-storage';
import { useId, useSyncExternalStore } from 'react';

const storageKey = 'slow-listening:desktop-lyric-size:v1', changed = 'slowtune:desktop-lyric-size';
const readSize = () => {
  try { const value = Number(preferenceStorage().getItem(storageKey)); return Number.isInteger(value) && value >= 20 && value <= 40 ? value : 28; }
  catch { return 28; }
};
// Desktop preferences are loaded after this module is imported.
let sessionSize: number | undefined;
const subscribe = (listener: () => void) => {
  const sync = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) { sessionSize = readSize(); listener(); } };
  window.addEventListener(changed, listener); window.addEventListener('storage', sync);
  return () => { window.removeEventListener(changed, listener); window.removeEventListener('storage', sync); };
};
export const useDesktopLyricSize = () => useSyncExternalStore(subscribe, () => sessionSize ??= readSize());

export function DesktopLyricFont() {
  const size = useDesktopLyricSize(), id = useId();
  return <label className="desktop-lyric-font" htmlFor={id}><span>沉浸歌词字号 <output>{size} px</output></span><input id={id} aria-label="沉浸歌词字号" type="range" min="20" max="40" step="2" value={size} onChange={event => {
    sessionSize = Number(event.target.value);
    try { preferenceStorage().setItem(storageKey, String(sessionSize)); } catch { /* Keep the session setting if storage is unavailable. */ }
    window.dispatchEvent(new Event(changed));
  }}/></label>;
}
