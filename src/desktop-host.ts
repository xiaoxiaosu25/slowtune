import { useEffect, useRef, useState } from 'react';
import type { LyricsController } from './useLyrics';
import type { LyricPlayback } from './LyricsView';

export type DesktopLyricsPreferences = { visible: boolean; locked: boolean; fontSize: number; color: string; highlight: string; lines: 1 | 2; translations: boolean };
type HostState = { preferences: DesktopLyricsPreferences };
export type DesktopPreferenceState = { pending: boolean; error: string | null };
export type DesktopRuntimeInfo = { appVersion: string; electron: string; chromium: string; node: string; platform: string; arch: string; preferences: DesktopPreferenceState };
type HostDocument = { sourceKey: string; title: string; status: string; offsetMs: number; synced: boolean; instrumental: boolean; lines: NonNullable<LyricsController['document']>['lines'] };
type DesktopAPI = {
  getState(): Promise<HostState>;
  restoreLocalSession(): Promise<boolean>;
  setLyricsVisible(visible: boolean): Promise<HostState>;
  setWindowAppearance(value: { theme: 'light' | 'dark'; mode: 'standard' | 'welcome' | 'welcome-artwork' | 'immersive' }): void;
  updateLyricsPreferences(value: Partial<DesktopLyricsPreferences>): Promise<HostState>;
  resetLyricsPosition(): Promise<void>;
  readPreferences(): Promise<Record<string, string>>;
  writePreference(key: string, value: string | null): Promise<void>;
  flushPreferences(): Promise<void>;
  getRuntimeInfo(): Promise<DesktopRuntimeInfo>;
  copyDiagnostics(text: string): Promise<void>;
  onPreferenceState(callback: (value: DesktopPreferenceState) => void): () => void;
  getDataDirectory(): Promise<string>;
  openDirectory(kind: 'data' | 'logs'): Promise<void>;
  saveWelcome(value: { settings: unknown; image?: string }): Promise<void>;
  quit(): void;
  onOpenLyricsSettings(callback: () => void): () => void;
  onWindowState(callback: (value: { fullscreen: boolean }) => void): () => void;
  publishDocument(value: HostDocument): void;
  publishClock(value: { sourceKey: string; position: number; playing: boolean }): void;
  playbackReleased(ok: boolean): void;
  onState(callback: (value: HostState) => void): () => void;
  onCommand(callback: (value: string) => void): () => void;
};
declare global { interface Window { slowTuneDesktop?: DesktopAPI } }

const empty: HostDocument = { sourceKey: '', title: '', status: '慢听 · 等待音乐', offsetMs: 0, synced: false, instrumental: false, lines: [] };
export function useDesktopHost(lyrics: LyricsController, playback: LyricPlayback, active: boolean, commands: { toggle(): unknown; previous(): unknown; next(): unknown; release(): unknown }, onError: (error: unknown) => void) {
  const api = window.slowTuneDesktop;
  const [visible, setVisible] = useState(false);
  const live = useRef({ lyrics, playback, active, commands, onError }); live.current = { lyrics, playback, active, commands, onError };
  const sourceKey = active ? lyrics.sourceKey : '';
  const publishClock = () => {
    const current = live.current;
    api?.publishClock({ sourceKey: current.active ? current.lyrics.sourceKey : '', position: Math.max(0, current.playback.readPosition()), playing: current.active && current.playback.playing });
  };
  useEffect(() => {
    if (!api) return;
    let disposed = false;
    const change = (state: HostState) => { if (!disposed) setVisible(state.preferences.visible); };
    const unsubscribe = api.onState(change);
    void api.getState().then(change).catch(error => { if (!disposed) live.current.onError(error); });
    const commands = api.onCommand(command => {
      if (command === 'release') { live.current.active = false; api.publishDocument(empty); void Promise.resolve().then(() => live.current.commands.release()).then(() => api.playbackReleased(true), error => { live.current.onError(error); api.playbackReleased(false); }); return; }
      if (command === 'resync') { publishClock(); return; }
      if (command !== 'toggle' && command !== 'previous' && command !== 'next') return;
      void Promise.resolve().then(() => live.current.commands[command]()).catch(error => live.current.onError(error));
    });
    return () => { disposed = true; unsubscribe(); commands(); api.publishDocument(empty); };
  }, [api]);
  useEffect(() => {
    if (!api) return;
    const document = active ? lyrics.document : undefined;
    api.publishDocument({ sourceKey, title: active ? lyrics.track?.title ?? '' : '', status: !active ? empty.status : lyrics.busy ? '正在寻找歌词…' : lyrics.error ? '歌词暂不可用' : '暂无匹配歌词', offsetMs: lyrics.offsetMs, synced: document?.synced === true, instrumental: document?.instrumental === true, lines: document?.lines ?? [] });
    publishClock();
  }, [api, sourceKey, active, lyrics.document, lyrics.offsetMs, lyrics.busy, lyrics.error, lyrics.track?.title]);
  useEffect(() => {
    if (!api) return;
    publishClock();
    if (!visible) return;
    // Timers keep reading the same audio element when the main window is in the tray.
    // No wall-clock extrapolation and no second player or lyric request.
    const timer = setInterval(publishClock, 50);
    return () => clearInterval(timer);
  }, [api, visible, sourceKey, playback.playing, playback.position]);
  useEffect(() => api ? playback.subscribePosition?.(publishClock) : undefined, [api, playback.subscribePosition]);
  return { available: !!api, visible, toggle: () => { void api?.setLyricsVisible(!visible).catch(onError); } };
}
