import React from 'react';
import { createRoot } from 'react-dom/client';
import { MusicClient } from '@studio/music-sources/client';
import { usePlayback } from '../../src/playback';
import { initializePreferenceStorage } from '../../src/preference-storage';

// Deliberately let prepare return after cancellation to exercise the bridge's
// late-result cleanup, rather than relying on fetch to hide that result.
const client = await MusicClient.connect(location.origin, { fetch: (input, init) => fetch(input, String(input).endsWith('/prepare') ? { ...init, signal: undefined } : init) });
function Probe() {
  const playback = usePlayback(client);
  (window as any).playbackProbe = playback;
  return <button onClick={() => void playback.retry()}>重试播放</button>;
}
await initializePreferenceStorage();
createRoot(document.getElementById('root')!).render(<Probe />);
