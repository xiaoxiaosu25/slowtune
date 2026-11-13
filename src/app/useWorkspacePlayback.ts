import { useEffect, useMemo, useRef, useState } from 'react';
import type { MusicClient } from '@studio/music-sources/client';
import { cancelled, errorText, key, time, type Track } from '../api';
import { isTrack, readSavedPlayback } from '../chart-playback';
import { useDesktopHost } from '../desktop-host';
import type { LyricPlayback } from '../LyricsView';
import {
  readPartPreferences,
  partPreferenceKey,
  type EntryContext,
  type PartPlaybackMode,
} from '../multipart';
import { usePlayback } from '../playback';
import { preferenceStorage } from '../preference-storage';
import { useLyrics } from '../useLyrics';
import { usePlayerStyle } from '../usePlayerStyle';
import { OPEN_LAYER } from '../ui/layers';
import { artworkUrl } from '../../server/artwork-url';
import type { Song, SongPlaybackSelection } from '../../server/song-library-types';
import { artworkKey } from './shared';
import type { Flash } from './useLibraryActions';
import type { useLibraryData } from './useLibraryData';
import { useMobileVisual } from './useMobileVisual';
import type { useSearchState } from './useSearchState';
import type { useSourceSettings } from './useSourceSettings';
import type { useTrackDialogs } from './useTrackDialogs';
import type { useWorkspaceDiscovery } from './useWorkspaceDiscovery';
import type { useWorkspaceNavigation } from './useWorkspaceNavigation';
import type { useWorkspaceSearch } from './useWorkspaceSearch';

type PlaybackOptions = {
  client: MusicClient;
  desktop: boolean;
  library: Pick<ReturnType<typeof useLibraryData>, 'lib'>;
  sourceSettings: ReturnType<typeof useSourceSettings>;
  dialogs: ReturnType<typeof useTrackDialogs>;
  navigation: ReturnType<typeof useWorkspaceNavigation>;
  discovery: Pick<ReturnType<typeof useWorkspaceDiscovery>, 'bilibiliAccount' | 'shelves'>;
  searchState: Pick<ReturnType<typeof useSearchState>, 'results' | 'searchOpen'>;
  searchForTitle: ReturnType<typeof useWorkspaceSearch>['searchForTitle'];
  flash: Flash;
  setError: (message: string) => void;
};

export function useWorkspacePlayback({
  client,
  desktop,
  library,
  sourceSettings,
  dialogs,
  navigation,
  discovery,
  searchState,
  searchForTitle,
  flash,
  setError,
}: PlaybackOptions) {
  const { lib } = library;
  const { sources, youtubeAvailable, youtubeEnabled, sourceBlocked } = sourceSettings;
  const { partsStore, popup, setPopup, setActionBusy, actionWork, setCanonical, open } = dialogs;
  const { page, compactQueue, queueVisible, closeQueue, setVersionsOpen, mobileSongId } = navigation;
  const { bilibiliAccount, shelves } = discovery;
  const { results, searchOpen } = searchState;
  const [playerStyle, selectPlayerStyle] = usePlayerStyle();
  const { mobileVisual, selectMobileVisual } = useMobileVisual();
  const [partPreferences, setPartPreferences] = useState(() => readPartPreferences(preferenceStorage()));
  const preferenceRef = useRef(partPreferences);
  preferenceRef.current = partPreferences;
  const playback = usePlayback(client, youtubeAvailable, partsStore, youtubeEnabled),
    { snapshot } = playback;
  const [audioQualityOpen, setAudioQualityOpen] = useState(false);
  useEffect(() => {
    playback.sourceChanged();
  }, [sources?.revision, sources?.sequence, youtubeAvailable]);
  useEffect(() => {
    if (lib)
      playback.updateSongs(
        lib.snapshot.songs,
        lib.snapshot.versions,
        lib.snapshot.catalogLinks,
        lib.snapshot.redirects,
      );
  }, [lib?.revision, desktop]);
  const [restoredQueue] = useState(() => readSavedPlayback(preferenceStorage()).tracks.length > 0),
    restorationNotified = useRef(false);
  const [playAction, setPlayAction] = useState<{
    controller: AbortController;
    track: Track;
    origin?: { tracks: Track[]; index: number };
    entryContext: EntryContext;
    loading: boolean;
    error?: string;
  }>();
  const preparationRetry = useRef<(() => Promise<unknown>) | undefined>(undefined),
    playRequestSerial = useRef(0),
    playMetadataWork = useRef<AbortController | undefined>(undefined);
  const startPlayback = async (
    task: () => Promise<unknown>,
    remember = true,
    continuing?: AbortController,
  ) => {
    if (!desktop) return task();
    if (playMetadataWork.current !== continuing) playMetadataWork.current?.abort();
    playMetadataWork.current = undefined;
    const sequence = ++playRequestSerial.current;
    preparationRetry.current = undefined;
    setPlayAction(undefined);
    const result = await task();
    if (playRequestSerial.current === sequence)
      preparationRetry.current = result === false && remember ? task : undefined;
    return result;
  };
  const cancelPlayback = () => {
    ++playRequestSerial.current;
    preparationRetry.current = undefined;
    if (desktop && playAction?.loading) {
      playAction.controller.abort();
      setActionBusy(false);
    }
    setPlayAction(undefined);
    playback.cancel();
  };
  const preparingPlayback = playback.preparing || snapshot.loading || !!(desktop && playAction?.loading);
  const [artworks, setArtworks] = useState<Record<string, string>>({});
  const [scrub, setScrub] = useState<number | null>(null),
    scrubValue = useRef<number | null>(null);
  useEffect(() => {
    playback.sourceChanged();
  }, [bilibiliAccount?.state, bilibiliAccount?.account?.id]);
  const checkedArtwork = useRef(new Set<string>());
  useEffect(() => {
    if (snapshot.state !== 'idle') {
      restorationNotified.current = true;
      return;
    }
    if (
      desktop ||
      page !== 'playing' ||
      !restoredQueue ||
      restorationNotified.current ||
      !snapshot.items.length
    )
      return;
    restorationNotified.current = true;
    flash('已恢复队列，点击播放从头听。');
  }, [desktop, page, restoredQueue, snapshot.state, snapshot.items.length]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.defaultPrevented ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        popup ||
        searchOpen ||
        (compactQueue && queueVisible) ||
        document.querySelector(OPEN_LAYER) ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable
      )
        return;
      if (e.code === 'Space') {
        if (target.closest('button,a,summary')) return;
        e.preventDefault();
        if (desktop && preparingPlayback) cancelPlayback();
        else if (snapshot.items.length) void startPlayback(() => playback.toggle(), false);
        return;
      }
      if (
        page !== 'playing' ||
        !current ||
        !snapshot.duration ||
        snapshot.state === 'idle' ||
        snapshot.state === 'stopped'
      )
        return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        void playback.skip(-5);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        void playback.skip(5);
        return;
      }
      if (e.code === 'KeyJ') {
        void playback.skip(-10);
        return;
      }
      if (e.code === 'KeyL') void playback.skip(10);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [popup, searchOpen, playback, page, compactQueue, queueVisible]);
  const rememberPartMode = (id: string, value: PartPlaybackMode) => {
    const next = { ...preferenceRef.current };
    delete next[id];
    next[id] = value;
    const bounded = Object.fromEntries(Object.entries(next).slice(-500));
    preferenceRef.current = bounded;
    setPartPreferences(bounded);
    try {
      preferenceStorage().setItem(partPreferenceKey, JSON.stringify(bounded));
    } catch {
      flash('播放偏好已在本次会话记住');
    }
  };
  async function choosePartMode(mode: PartPlaybackMode) {
    if (!popup?.track || !popup.anchorId || playback.currentTrackId() !== popup.anchorId) return false;
    if (mode === 'all' && !playback.expandParts(popup.anchorId, popup.parts ?? [], popup.track.partsGroupTitle ?? popup.track.title)) return false;
    rememberPartMode(popup.track.ref.id, mode);
    setPopup(null);
    flash(mode === 'all' ? '已加入整组，沿用当前播放模式' : '已记住：这个视频播放本 P');
    return true;
  }
  async function trackAction(
    t: Track,
    action: 'play' | 'add',
    origin?: { tracks: Track[]; index: number },
    entryContext: EntryContext = 'video',
  ) {
    if (action === 'play') playback.cancelPending();
    actionWork.current?.abort();
    const controller = new AbortController();
    actionWork.current = controller;
    setActionBusy(true);
    setError('');
    const deadline = desktop && action === 'play' ? Date.now() + 60000 : undefined,
      timer = deadline
        ? setTimeout(
            () => controller.abort(new DOMException('Playback operation timed out', 'TimeoutError')),
            60000,
          )
        : undefined;
    if (desktop && action === 'play') {
      playMetadataWork.current = controller;
      ++playRequestSerial.current;
      preparationRetry.current = undefined;
      playback.dismiss();
      setPlayAction({ controller, track: t, origin, entryContext, loading: true });
    }
    try {
      const entry = await partsStore.read(t.ref, controller.signal);
      controller.signal.throwIfAborted();
      const resolved = { ...t, ...entry, ...(entry.parts && entry.parts.length > 1 ? {partsGroupTitle:t.partsGroupTitle ?? t.title} : {}) },
        parts = entry.parts ?? [entry],
        multiple = t.ref.provider === 'bilibili' && parts.length > 1;
      setCanonical((old) => ({ ...old, [key(t.ref)]: entry.ref }));
      if (action === 'add' && entryContext === 'video' && multiple) {
        if (popup?.track?.ref.id === t.ref.id)
          setPopup((old) =>
            old ? { ...old, track: resolved, parts, intent: 'enqueue', step: (old.step ?? 0) + 1 } : old,
          );
        else open({ type: 'track', track: resolved, parts, origin, entryContext, intent: 'enqueue' });
        return true;
      }
      const ok = await (action === 'play'
        ? startPlayback(() => playback.play(resolved, origin, true, deadline), true, controller)
        : playback.add(resolved, true));
      if (controller.signal.aborted || !ok) return false;
      if (action === 'add') {
        flash('已加入队尾');
        return true;
      }
      const anchorId = playback.currentTrackId();
      if (entryContext === 'video' && multiple && anchorId) {
        const preference = preferenceRef.current[t.ref.id];
        if (preference === 'all' && playback.expandParts(anchorId, parts, resolved.partsGroupTitle)) {
          if (!desktop) flash('已加入整组，沿用当前播放模式');
          return true;
        }
        if (desktop && preference !== 'single') {
          const next = {
            track: resolved,
            parts,
            origin,
            entryContext,
            intent: 'play-choice' as const,
            anchorId,
          };
          if (popup?.track?.ref.id === t.ref.id) setPopup((old) => (old ? { ...old, ...next } : old));
          else open({ type: 'track', ...next });
        }
      }
      return true;
    } catch (issue) {
      if (
        desktop &&
        action === 'play' &&
        controller.signal.reason?.name === 'TimeoutError' &&
        playMetadataWork.current === controller
      )
        setPlayAction({
          controller,
          track: t,
          origin,
          entryContext,
          loading: false,
          error: errorText({ code: 'timeout' }),
        });
      else if (!cancelled(issue) && !controller.signal.aborted) {
        if (desktop && action === 'play')
          setPlayAction({
            controller,
            track: t,
            origin,
            entryContext,
            loading: false,
            error: errorText(issue),
          });
        else setError(errorText(issue));
      }
      return false;
    } finally {
      clearTimeout(timer);
      if (playMetadataWork.current === controller) playMetadataWork.current = undefined;
      if (desktop && action === 'play')
        setPlayAction((old) =>
          old?.controller === controller && old.loading ? { ...old, loading: false } : old,
        );
      if (actionWork.current === controller) {
        setActionBusy(false);
        actionWork.current = null;
      }
    }
  }
  const current = snapshot.current;
  const lyricTrack =
    current && !sourceBlocked(current) && (current.ref.provider === 'youtube' || current.ref.part)
      ? current
      : null;
  const lyrics = useLyrics(
    lyricTrack,
    snapshot.duration,
    lib?.snapshot.versions.find((version) => version.id === current?.versionId),
    snapshot.state !== 'idle' && snapshot.state !== 'stopped',
  );
  const currentVersion = lib?.snapshot.versions.find(
    (version) => current && key(version.ref) === key(current.ref),
  );
  const currentSong = lib?.snapshot.songs.find(
    (song) => song.id === (current?.songId ?? currentVersion?.songId),
  );
  const openVersions = () => {
    closeQueue();
    lyrics.closeSettings();
    setVersionsOpen(true);
  };
  const openLyricsManagement = () => {
    setVersionsOpen(false);
    closeQueue();
    lyrics.openSettings();
  };
  const chooseLyrics = () => {
    setVersionsOpen(false);
    closeQueue();
    lyrics.openSelector();
  };
  useEffect(() => {
    if (!desktop || page !== 'playing') setVersionsOpen(false);
  }, [desktop, page]);
  const lyricPlayback: LyricPlayback = {
    position: snapshot.position,
    duration: snapshot.duration,
    playing: snapshot.playing && !snapshot.loading,
    readPosition: playback.readPosition,
    ...(desktop ? { subscribePosition: playback.clock.subscribe } : {}),
  };
  const desktopHost = useDesktopHost(
    lyrics,
    lyricPlayback,
    snapshot.state !== 'idle' && snapshot.state !== 'stopped',
    {
      toggle: () => (preparingPlayback ? cancelPlayback() : startPlayback(() => playback.toggle(), false)),
      previous: () => startPlayback(() => playback.previous(), false),
      next: () => startPlayback(() => playback.next(), false),
      release: playback.release,
    },
    (issue) => setError(errorText(issue)),
  );
  const bottomLyricsVisible =
    desktop &&
    !desktopHost.available &&
    !!lyricTrack &&
    lyrics.bottom &&
    snapshot.state !== 'idle' &&
    snapshot.state !== 'stopped';
  const collectArtworks = () => {
    const known = { ...artworks };
    for (const t of [
      ...shelves.flatMap((s) => s.page?.items ?? []),
      ...Object.values(results).flatMap((r) => r.items),
      ...snapshot.items,
      ...(current ? [current] : []),
    ])
      if (isTrack(t) && t.artwork) known[artworkKey(t)] = t.artwork;
    return known;
  };
  const desktopArtworks = useMemo(
    () => (desktop ? collectArtworks() : undefined),
    [desktop, artworks, shelves, results, snapshot.items, current],
  );
  const knownArtworks = desktop ? desktopArtworks! : collectArtworks();
  const currentArtwork =
    current && !sourceBlocked(current)
      ? artworkUrl(current.artwork ?? knownArtworks[artworkKey(current)])
      : undefined;
  useEffect(() => {
    const c = new AbortController();
    const targets = [...(current ? [current] : [])].filter(
      (t) => !sourceBlocked(t) && !t.artwork && !checkedArtwork.current.has(artworkKey(t)),
    );
    for (const t of targets)
      void partsStore
        .read(t.ref, c.signal, false)
        .then((entry) => {
          if (!c.signal.aborted && entry.artwork)
            setArtworks((old) => ({ ...old, [artworkKey(t)]: entry.artwork! }));
        })
        .catch(() => {});
    return () => c.abort();
  }, [client, current?.ref.id, current?.ref.part, youtubeEnabled]);
  const commitScrub = () => {
    const value = scrubValue.current;
    if (value === null) return;
    scrubValue.current = null;
    setScrub(null);
    void playback.seek(value);
  };
  // Let the range's final native change finish before clearing its controlled preview.
  const releaseScrub = () => requestAnimationFrame(commitScrub);
  const sleepRunning = playback.sleep.status === 'running';
  const sleepBadge = !sleepRunning
    ? null
    : playback.sleep.trigger?.type === 'duration'
      ? time(desktop ? Math.ceil(playback.sleep.remainingMs / 1000) : playback.sleep.remainingMs / 1000)
      : `${playback.sleep.remainingItems ?? 1} 首`;
  const mode: 'shuffle' | 'all' | 'one' | 'sequential' =
    snapshot.order === 'shuffle'
      ? 'shuffle'
      : snapshot.repeat === 'all'
        ? 'all'
        : snapshot.repeat === 'one'
          ? 'one'
          : 'sequential';
  const playbackLabel = preparingPlayback
    ? '正在准备音轨'
    : snapshot.playing
      ? '正在播放'
      : snapshot.state === 'paused'
        ? '已暂停'
        : snapshot.state === 'stopped'
          ? '已停止'
          : snapshot.state === 'ended'
            ? '播放已结束'
            : current
              ? '准备播放'
              : '等待音乐';
  const retryPlayback = () => {
    if (playAction?.error) {
      void trackAction(playAction.track, 'play', playAction.origin, playAction.entryContext);
      return;
    }
    if (playback.chartSearchTitle) {
      searchForTitle(playback.chartSearchSong ?? playback.chartSearchTitle);
      return;
    }
    const retry = preparationRetry.current;
    void startPlayback(retry ?? (() => playback.retry()));
  };
  const dismissPlayback = () => {
    setPlayAction(undefined);
    preparationRetry.current = undefined;
    playback.dismiss();
  };
  const enqueueSongs = async (items: { selection: SongPlaybackSelection; song: Song }[]) => {
    const ok = await playback.enqueueSelections(items);
    if (ok) flash('已将 ' + items.length + ' 首歌曲加入队尾');
    return ok;
  };
  const mobileEditedSong = lib?.snapshot.songs.find((song) => song.id === mobileSongId);
  const mobileVersionCount = currentSong
    ? (lib?.snapshot.versions.filter((version) => version.songId === currentSong.id).length ?? 0)
    : 0;
  const mobileArtist = currentSong?.artists?.join(' / ') || current?.artists?.join(' / ');
  const mobileVersionPlayback = {
    currentVersionId: currentVersion?.id,
    preparing: preparingPlayback,
    error: playback.error,
    play: (selection: SongPlaybackSelection, song: Song) =>
      playback.playSelection(selection, song, currentSong?.id === song.id),
  };
  const mobilePlayerEmpty =
    !current && !snapshot.items.length && !playback.preparing && !snapshot.loading && !playback.error;
  return {
    playerStyle,
    selectPlayerStyle,
    mobileVisual,
    selectMobileVisual,
    partPreferences,
    rememberPartMode,
    choosePartMode,
    playback,
    snapshot,
    audioQualityOpen,
    setAudioQualityOpen,
    playAction,
    startPlayback,
    cancelPlayback,
    preparingPlayback,
    trackAction,
    current,
    lyrics,
    currentVersion,
    currentSong,
    openVersions,
    openLyricsManagement,
    chooseLyrics,
    lyricPlayback,
    desktopHost,
    bottomLyricsVisible,
    knownArtworks,
    currentArtwork,
    scrub,
    setScrub,
    scrubValue,
    commitScrub,
    releaseScrub,
    sleepRunning,
    sleepBadge,
    mode,
    playbackLabel,
    retryPlayback,
    dismissPlayback,
    enqueueSongs,
    mobileEditedSong,
    mobileVersionCount,
    mobileArtist,
    mobileVersionPlayback,
    mobilePlayerEmpty,
  };
}
