export type AudioAnalysisState = 'idle' | 'waiting' | 'ready' | 'unavailable';

/** One optional analysis graph per playback engine, never per artwork or song. */
export class PlaybackAudioAnalysis {
  private context?: AudioContext;
  private source?: MediaElementAudioSourceNode;
  private node: AnalyserNode | null = null;
  private requested = false;
  private disposed = false;
  private pending?: Promise<void>;
  private state: AudioAnalysisState = 'idle';
  private listeners = new Set<() => void>();

  constructor(private audio: HTMLAudioElement) {
    document.addEventListener('pointerdown', this.onGesture, true);
    document.addEventListener('keydown', this.onGesture, true);
    audio.addEventListener('playing', this.onPlaying);
  }

  get analyser() { return this.node; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  request = (enabled: boolean, userGesture = false) => {
    this.requested = enabled;
    if (enabled) {
      if (this.source && this.context?.state === 'running') this.publish('ready');
      else if (this.state !== 'unavailable') this.publish('waiting');
      if (userGesture || navigator.userActivation?.isActive) void this.ensure();
    }
  };

  private publish(state: AudioAnalysisState) {
    if (this.disposed || state === this.state) return;
    this.state = state;
    this.listeners.forEach(listener => listener());
  }

  private onGesture = (event: Event) => {
    if (event.isTrusted && (this.requested || this.source)) void this.ensure();
  };
  private onPlaying = () => {
    // An existing graph may need resuming after an OS/background interruption.
    // Do not create one here: a restored spectrum waits for a user gesture.
    if (this.source) void this.ensure();
  };
  private onContextState = () => {
    if (this.source) this.publish(this.context?.state === 'running' ? 'ready' : 'waiting');
  };

  private ensure(): Promise<void> {
    if (this.disposed || (!this.requested && !this.source) || (this.state === 'unavailable' && !this.source)) return Promise.resolve();
    if (this.pending) return this.pending;
    const work = async () => {
      try {
        if (!this.context) {
          const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!Context) { this.publish('unavailable'); return; }
          this.context = new Context();
          this.context.addEventListener('statechange', this.onContextState);
        }
        const context = this.context;
        if (context.state !== 'running') await context.resume();
        if (this.disposed || (!this.requested && !this.source)) return;
        if (!this.source) {
          // Binding reroutes the media's output. Only bind after the context is
          // running, and keep a direct output independent of the analyser.
          if (context.state !== 'running') { this.publish('waiting'); return; }
          const url = this.audio.currentSrc || this.audio.src;
          if (url && new URL(url, location.href).origin !== location.origin) { this.publish('unavailable'); return; }
          const node = context.createAnalyser();
          node.fftSize = 2048;
          node.smoothingTimeConstant = .78;
          this.source = context.createMediaElementSource(this.audio);
          this.source.connect(context.destination);
          this.source.connect(node);
          this.node = node;
        }
        this.publish(context.state === 'running' ? 'ready' : 'waiting');
      } catch {
        this.publish(this.source ? 'waiting' : 'unavailable');
        // A failure before binding leaves native playback entirely intact.
        if (!this.source && this.context) {
          const context = this.context;
          this.context = undefined;
          context.removeEventListener('statechange', this.onContextState);
          void context.close().catch(() => {});
        }
      }
    };
    this.pending = work().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener('pointerdown', this.onGesture, true);
    document.removeEventListener('keydown', this.onGesture, true);
    this.audio.removeEventListener('playing', this.onPlaying);
    this.listeners.clear();
    this.source?.disconnect();
    this.node?.disconnect();
    this.node = null;
    if (this.context) {
      this.context.removeEventListener('statechange', this.onContextState);
      void this.context.close().catch(() => {});
    }
  };
}
