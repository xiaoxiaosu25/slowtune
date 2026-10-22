import { preferenceStorage } from './preference-storage';
import { useEffect, useState } from 'react';

export type PlayerStyle = 'floating' | 'bar';
export const playerStyleStorageKey = 'slow-listening:player-style:v1';

function readPlayerStyle(): PlayerStyle {
  try { return preferenceStorage().getItem(playerStyleStorageKey) === 'bar' ? 'bar' : 'floating'; }
  catch { return 'floating'; }
}

export function usePlayerStyle() {
  const [style, setStyle] = useState<PlayerStyle>(readPlayerStyle);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== playerStyleStorageKey && event.key !== null) return;
      try { if (event.storageArea === preferenceStorage()) setStyle(readPlayerStyle()); }
      catch { /* Keep the current appearance when browser storage is unavailable. */ }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const selectStyle = (next: PlayerStyle) => {
    setStyle(next);
    try { preferenceStorage().setItem(playerStyleStorageKey, next); }
    catch { /* The choice still applies for this page session. */ }
  };
  return [style, selectStyle] as const;
}
