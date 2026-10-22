import { StudioPlayer } from '@studio/player/core';
import { QueueController } from '@studio/player/queue';
import { SleepTimerController } from '@studio/player/sleep-timer';
import { MusicPlayerBridge } from '@studio/music-sources/player';
import { validateRef } from '@studio/music-sources';

// Stage-0 experiment, not installed in the product. Uses only public package APIs.
let probe;
let leaseSerial = 0;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
window.switchProbe = {
  async reset() {
    if (probe) { probe.queue.destroy(); probe.sleep.destroy(); await probe.player.destroyAsync(); await probe.bridge.dispose(); probe.audio.remove(); }
    const audio = document.createElement('audio'); document.body.append(audio);
    const refs = new Map(), labels = new Map();
    const entry = ref => { validateRef(ref); return { ref, resourceId: 'source:' + ref.id, title: labels.get(ref.id), durationSeconds: 30 }; };
    const leases = [], aliases = new Map(), planSources = new WeakMap();
    const bridge = new MusicPlayerBridge({
      metadata: async ref => entry(ref),
      prepare: async ({ ref }) => {
        const leaseId = labels.get(ref.id) + '-' + (++leaseSerial); leases.push(leaseId);
        return { resourceId: 'source:' + ref.id, entry: entry(ref), format: { mimeType: 'audio/wav', codec: 'pcm', container: 'wav' }, leaseId,
          delivery: { requiresHost: false, url: new URL('/audio.wav?lease=' + leaseId, location.href).href } };
      },
      release: id => fetch(new URL('/lease/' + id, location.href), { method: 'DELETE' }),
    });
    const player = new StudioPlayer({ nativeElementTag: 'audio', autoResume: false, sourceOptions: { expiryCheckIntervalMs: 0 }, sourceResolver: {
      ...bridge.resolver,
      resolveUrl: async (id, plan, reason, context) => {
        // The bridge bounds its descriptor cache at 64. Retain the committed exact ref,
        // and re-register it before refreshing rather than relying on cache residency.
        const descriptor = aliases.get(id);
        const source = descriptor ? await bridge.source(descriptor.ref, { signal: context.signal }) : undefined;
        const result = await bridge.resolver.resolveUrl(source?.resourceId ?? id, plan, reason, context);
        return { ...result, resourceId: id, metadata: { ...result.metadata, versionId: result.metadata.title } };
      },
    } }); player.attach(audio);
    const queue = new QueueController(player), sleep = new SleepTimerController(player);
    const state = probe = { audio, player, queue, sleep, bridge, selected: new Map([['q1', 'a'], ['q2', 'next']]), requests: new Map(), serial: 0, generation: 0, pauseEpoch: 0, leases, ownCommit: false, sourceEnabled: true };
    state.plan = async (version, itemId) => {
      if (!refs.has(version)) { const id = String(refs.size + 1).padStart(11, '0'); refs.set(version, { provider: 'youtube', kind: 'video', id }); labels.set(id, version); }
      const source = await bridge.source(refs.get(version));
      const original = await source.prepare({ signal: new AbortController().signal, restart: true });
      const plan = { ...original, resourceId: 'probe:' + itemId, metadata: { ...original.metadata, title: '歌曲', versionId: version } };
      planSources.set(plan, { resourceId: source.resourceId, ref: refs.get(version) });
      return plan;
    };
    player.on('pauseintent', () => { state.pauseEpoch++; });
    player.on('loadstart', () => { if (!state.ownCommit) state.generation++; });
    player.on('stop', () => { state.generation++; });
    queue.setItems(['q1', 'q2'].map(id => ({ id, title: id, source: { resourceId: 'probe:' + id, prepare: async () => {
      const staged = state.staged;
      if (staged?.itemId === id) { state.staged = undefined; staged.request.transferred = true; state.selected.set(id, staged.version); aliases.set('probe:' + id, planSources.get(staged.plan)); return staged.plan; }
      const plan = await state.plan(state.selected.get(id), id); aliases.set('probe:' + id, planSources.get(plan)); return plan;
    } } })));
    await queue.selectId('q1', { restart: true });
    return this.snapshot();
  },
  snapshot() {
    const s = probe, q = s.queue.snapshot;
    return { paused: s.audio.paused, time: s.audio.currentTime, state: s.player.state, version: s.player.currentMetadata?.versionId,
      current: q.current?.id, items: q.items.map(item => item.id), order: q.order, repeat: q.repeat, history: [...q.history],
      remainingItems: s.sleep.snapshot.remainingItems, sleep: s.sleep.snapshot.status, volume: s.player.volume, rate: s.player.playbackRate,
      requests: [...s.requests].map(([id, request]) => ({ id, outcome: request.outcome })), leases: [...s.leases], liveLeases: s.bridge.diagnostics().leases };
  },
  begin(version, play = false) {
    const s = probe, id = ++s.serial, gate = deferred(), generation = ++s.generation, itemId = s.queue.snapshot.current.id, pauseEpoch = s.pauseEpoch;
    const request = { gate, outcome: 'preparing', transferred: false, version }; s.requests.set(id, request);
    request.task = (async () => {
      let plan;
      try {
        plan = await gate.promise;
        if (generation !== s.generation || itemId !== s.queue.snapshot.current?.id || !s.sourceEnabled || s.sleep.snapshot.status === 'expired' || s.player.state === 'stopped') { request.outcome = 'cancelled'; return; }
        const autoplay = play && pauseEpoch === s.pauseEpoch || !s.audio.paused && s.player.playbackRequested;
        s.staged = { itemId, plan, version, request };
        let pending;
        s.ownCommit = true;
        try { pending = s.queue.selectId(itemId, { restart: true, autoplay }); } finally { s.ownCommit = false; }
        await pending;
        request.outcome = 'committed';
      } catch (error) { request.outcome = 'failed'; request.error = error.message; }
      finally { if (plan && !request.transferred) s.player.sourceController.releaseUnusedPlan(plan); }
    })();
    return id;
  },
  async release(id) { const s = probe, request = s.requests.get(id); request.gate.resolve(await s.plan(request.version, 'q1')); },
  fail(id) { probe.requests.get(id).gate.reject(new Error('controlled source failure')); },
  cancel() { probe.generation++; },
  disable() { probe.sourceEnabled = false; probe.generation++; },
  pause() { probe.player.pause(); },
  async next() { await probe.queue.next(); },
  async stop() { await probe.player.stop(); },
  controls() { probe.player.setVolume(.31); probe.player.setPlaybackRate(1.5); probe.queue.setOrder('shuffle'); probe.queue.setRepeat('all'); probe.sleep.start({ trigger: { type: 'items', count: 2 } }); },
  expire() { probe.sleep.start({ trigger: { type: 'duration', durationMs: 1 } }); },
  async baselineFailure() {
    const s = probe;
    const failed = s.player.load({ resourceId: 'baseline-b', prepare: async () => { throw new Error('controlled source failure'); } });
    const pausedBeforeFailure = s.audio.paused;
    await failed.catch(() => {});
    return { pausedBeforeFailure, pausedAfterFailure: s.audio.paused, currentQueueId: s.queue.snapshot.current?.id ?? null, state: s.player.state };
  },
  async refresh() { await probe.player.sourceController.refreshSource('expired'); },
  async crossResourceReplacement() {
    const plan = { ...await probe.plan('b', 'q1'), resourceId: 'different-resource' };
    try { probe.player.replaceSource(plan); return false; }
    catch { return true; }
    finally { probe.player.sourceController.releaseUnusedPlan(plan); }
  },
};
