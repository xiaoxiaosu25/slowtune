import { createRoot } from 'react-dom/client';
import { usePlayback } from '../../src/playback';
import { SleepPanel } from '../../src/SleepPanel';
import { initializePreferenceStorage } from '../../src/preference-storage';

// Exercises the product hook and panel with the fixed player and native audio.
const params = new URLSearchParams(location.search), desktop = !params.has('mobile');
let quits = 0, preparations = 0, releaseMetadata;
if (params.has('host')) {
  window.slowTuneDesktop = { readPreferences: async () => ({}), writePreference: async () => {}, onCommand: () => () => {}, quit: () => { quits++; } };
}
localStorage.clear();
const tracks = [1, 2].map(index => ({ ref: { provider: 'bilibili', kind: 'video', id: 'BV000000000' + index, part: String(index) },
  resourceId: 'fixture-' + index, title: '定时测试 ' + index, durationSeconds: 3, url: 'https://www.bilibili.com/video/BV000000000' + index }));
const client = {
  capabilities: () => ({ operations: ['metadata', 'prepare'], limitations: [], anonymous: true }),
  metadata: async (ref, options) => {
    if (releaseMetadata) await releaseMetadata.promise;
    options?.signal?.throwIfAborted();
    return tracks.find(track => track.ref.id === ref.id);
  },
  prepare: async request => {
    preparations++;
    const entry = tracks.find(track => track.ref.id === request.ref.id);
    return { entry, resourceId: entry.resourceId, format: { codec: 'pcm', mimeType: 'audio/wav', container: 'wav' },
      delivery: { url: new URL('/audio.wav?n=' + preparations, location.href).href, requiresHost: false } };
  },
};
function Probe() {
  const playback = usePlayback(client);
  window.sleepProbe = {
    ready: !!playback.sleepTimer,
    snapshot: () => ({ ...playback.sleepTimer.snapshot, quits, preparations, currentId: playback.currentTrackId(), state: playback.snapshot.state, preparing: playback.preparing, error: playback.error }),
    start: rule => playback.startSleep(rule), cancel: () => playback.cancelSleep(),
    play: () => playback.playAll(tracks), next: () => playback.next(), toggle: () => playback.toggle(),
    rate: value => playback.rate(value), mode: () => playback.cycleMode(), stop: () => playback.stop(),
    deferSelection: () => {
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      releaseMetadata = { promise, release };
      void playback.play(tracks[1]);
    },
    releaseSelection: () => { const held = releaseMetadata; releaseMetadata = undefined; held.release(); },
  };
  return <SleepPanel timer={playback.sleepTimer} desktop={desktop} />;
}
void initializePreferenceStorage().then(() => createRoot(document.getElementById('root')).render(<Probe />));
