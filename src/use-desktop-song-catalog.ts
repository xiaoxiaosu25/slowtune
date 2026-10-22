import { useEffect, useRef } from 'react';
import { request } from './api';

/** Authenticated desktop visits progressively enrich retained songs, one bounded request at a time. */
export function useDesktopSongCatalog(enabled: boolean, refresh: () => Promise<unknown>,deferred=false) {
  const latest = useRef(refresh); latest.current = refresh;
  useEffect(() => {
    if (!enabled || deferred) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      let delay = 60000;
      const editing = !!document.querySelector('dialog[open]');
      if (editing) delay = 5000;
      if (!editing && document.visibilityState === 'visible' && navigator.onLine) {
        try {
          const result = await request<{ more: boolean; retryAfterMs?: number }>('/api/song-library/catalog/backfill', { surface: 'desktop' }, controller.signal);
          if (controller.signal.aborted) return;
          if (result.more) { await latest.current(); delay = result.retryAfterMs ?? 5000; }
        } catch { /* Matching failure leaves playback and library editing available. */ }
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void run(), delay);
    };
    timer = setTimeout(() => void run(), 3000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [enabled,deferred]);
}
