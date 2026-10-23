import type { StudioPlayer, PlaybackCompletion, PlayerEventType, PlayerEventListener } from '@studio/player/core';
import { SleepTimerController } from '@studio/player/sleep-timer';
import { desktopSurface } from './song-search';

export function createSleepTimer(player: StudioPlayer, audio: HTMLAudioElement): SleepTimerController {
  let seekedToEnd = false;
  const seeking = () => { seekedToEnd = Number.isFinite(audio.duration) && audio.currentTime >= audio.duration - .001; };
  audio.addEventListener('seeking', seeking);
  const unsubscribe = player.on('loadstart', () => { seekedToEnd = false; });
  // Native audio can emit timeupdate between seeking to the end and ended.
  // Keep that seek visible to the desktop timer even if the player has already
  // cleared its discontinuity flag. Other consumers retain the original event.
  const on = (event: PlayerEventType, listener: PlayerEventListener) => player.on(event, event === 'beforeended'
    ? (completion: PlaybackCompletion) => listener(desktopSurface() && seekedToEnd ? { ...completion, natural: false } : completion)
    : listener);
  const timer = new SleepTimerController(new Proxy(player, { get(target, property) {
    if (property === 'on') return on;
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } }));
  timer.addEventListener('destroy', () => { audio.removeEventListener('seeking', seeking); unsubscribe(); }, { once: true });
  return timer;
}
