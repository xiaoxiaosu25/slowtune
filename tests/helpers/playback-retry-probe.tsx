import React from 'react';
import { createRoot } from 'react-dom/client';
import { connectSourceClient } from '../../src/source-client';
import { usePlayback } from '../../src/playback';
import { initializePreferenceStorage } from '../../src/preference-storage';

// Deliberately let prepare return after cancellation to exercise the bridge's
// late-result cleanup, rather than relying on fetch to hide that result.
const nativeFetch=window.fetch.bind(window);
window.fetch=(input,init)=>nativeFetch(input,String(input).endsWith('/prepare')?{...init,signal:undefined}:init);
const client = await connectSourceClient(location.origin,new AbortController().signal);
function Probe() {
  const playback = usePlayback(client);
  (window as any).playbackProbe = playback;
  return <button onClick={() => void playback.retry()}>重试播放</button>;
}
await initializePreferenceStorage();
createRoot(document.getElementById('root')!).render(<Probe />);
