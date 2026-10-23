export interface PlaybackClockSnapshot {
  position: number;
  duration?: number;
  buffered: { start: number; end: number }[];
}

/** A live media clock; publishing does not update the workspace's React state. */
export class PlaybackClock {
  private value: PlaybackClockSnapshot = { position: 0, buffered: [] };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  publish(value: PlaybackClockSnapshot) {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}
