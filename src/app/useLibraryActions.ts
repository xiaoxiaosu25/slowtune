import { useEffect, useMemo, useRef, useState } from 'react';
import type { MusicEntry } from '@studio/music-sources';
import { cancelled, creator, errorText, key, request, type Track } from '../api';
import { catalogSongKey, songSourceKey } from '../../server/song-library-policy';
import type {
  ChartSongContext,
  SongLibraryState as LibraryData,
  SongDuplicatePolicy as DuplicatePolicy,
} from '../../server/song-library-types';
import type { PartBatchAction } from '../PartsPanel';
import type { EntryContext } from '../multipart';
import type { useLibraryData } from './useLibraryData';
import type { useSearchState } from './useSearchState';
import type { useTrackDialogs } from './useTrackDialogs';
import type { useWorkspaceNavigation } from './useWorkspaceNavigation';
import { displayTitle, favoritesId } from './shared';

export type Flash = (message: string, action?: { label: string; run: () => void }) => void;

type LibraryOptions = {
  client: unknown;
  desktop: boolean;
  library: ReturnType<typeof useLibraryData>;
  navigation: Pick<ReturnType<typeof useWorkspaceNavigation>, 'selected' | 'setSelected'>;
  dialogs: ReturnType<typeof useTrackDialogs>;
  results: ReturnType<typeof useSearchState>['results'];
  sourceBlocked: (track: Track) => boolean;
  closeSearch: () => void;
  flash: Flash;
  setError: (message: string) => void;
};

export function useLibraryActions({
  client,
  desktop,
  library,
  navigation,
  dialogs,
  results,
  sourceBlocked,
  closeSearch,
  flash,
  setError,
}: LibraryOptions) {
  const { lib, libraryError, writeWork, libraryReadSerial, updateLibrary } = library;
  const { selected, setSelected } = navigation;
  const {
    canonical,
    setCanonical,
    partsStore,
    popup,
    setPopup,
    open,
    setListImport,
    setGroupTrack,
    showParts,
    actionWork,
    setActionBusy,
  } = dialogs;
  const [saving, setSaving] = useState(false),
    [pending, setPending] = useState<any>();
  const [favoriteTarget, setFavoriteTarget] = useState<string>();
  const favoriteWork = useRef<{ key: string; controller: AbortController } | undefined>(undefined);
  const [chartFavoriteAction, setChartFavoriteAction] = useState<{ key: string; body: unknown }>();
  const requireLibrary = () => {
    if (lib) return true;
    flash(libraryError ? '歌单与收藏暂不可用，请在歌单页重试。' : '正在读取歌单与收藏，请稍后重试。');
    return false;
  };
  const importTracks = (
    items: Track[],
    title = '当前列表',
    context: 'video' | 'part' = 'video',
    excluded = 0,
  ) => {
    if (!requireLibrary()) return;
    const allowed = items.filter((t) => !sourceBlocked(t));
    if (!allowed.length) return;
    setListImport({
      title,
      source: { kind: 'entries', items: allowed.map((track) => ({ ref: track.ref, context })) },
      labels: allowed.map((track) => track.title),
      excluded: excluded + items.length - allowed.length,
    });
  };
  useEffect(() => {
    if (lib && selected !== favoritesId && !lib.snapshot.playlists.some((p) => p.id === selected))
      setSelected(favoritesId);
  }, [lib, selected]);
  useEffect(() => () => writeWork.current?.abort(), [client]);
  async function mutate(body: any, close = true, localFeedback = false) {
    if (saving || writeWork.current || !requireLibrary() || !lib) return;
    const revision = lib.revision;
    ++libraryReadSerial.current;
    setSaving(true);
    if (!localFeedback) {
      setError('');
      setPending(body);
    }
    const c = new AbortController();
    writeWork.current = c;
    try {
      const path = body.save ? '/sources' : body.context ? '/chart-favorites' : '/edits';
      const data = await request<
        LibraryData & { summary?: { changed: number; unchanged: number }; playlistId?: string }
      >('/api/song-library' + path, { revision, ...body }, c.signal);
      updateLibrary(data);
      if (!localFeedback) setPending(undefined);
      if (data.playlistId) setSelected(data.playlistId);
      if (!localFeedback)
        flash(
          data.summary
            ? `已处理 ${data.summary.changed} 项，${data.summary.unchanged} 项无需更改`
            : '资料已保存',
        );
      if (close) setPopup(null);
      return data;
    } catch (e) {
      if (!localFeedback) setError(errorText(e));
      if ((e as { code?: string }).code === 'conflict') {
        try {
          updateLibrary(await request<LibraryData>('/api/song-library', undefined, c.signal));
        } catch {}
      }
      if (localFeedback) throw e;
    } finally {
      setSaving(false);
      writeWork.current = null;
    }
  }
  const libraryIndex = useMemo(() => {
    const favorites = new Map(lib?.snapshot.favorites.map((favorite) => [favorite.songId, favorite]) ?? []);
    const chartFavorites = new Map(
      (lib?.snapshot.catalogLinks ?? []).flatMap((link) => {
        const favorite = favorites.get(link.songId);
        return favorite ? [[link.key, favorite] as const] : [];
      }),
    );
    return {
      owners: new Map(
        lib?.snapshot.versions.map((version) => [songSourceKey(version.ref), version.songId]) ?? [],
      ),
      songs: new Map(lib?.snapshot.songs.map((song) => [song.id, song]) ?? []),
      favorites: new Set(favorites.keys()),
      chartFavorites,
      chartFavoriteKeys: new Set(chartFavorites.keys()),
    };
  }, [lib]);
  const toggleChartFavorite = async (context: ChartSongContext) => {
    if (saving || writeWork.current || !requireLibrary()) return;
    const chartKey = catalogSongKey(context),
      favorite = libraryIndex.chartFavorites.get(chartKey);
    const body = favorite
      ? { edits: [{ type: 'remove-favorite', favoriteId: favorite.favoriteId }] }
      : { context };
    setChartFavoriteAction({ key: chartKey, body });
    const data = await mutate(body, false);
    if (data) flash(`${favorite ? '已取消收藏' : '已收藏'}「${context.title}」`);
  };
  const songForTrack = (track: Track) => {
    if (track.songId) return track.songId;
    try {
      return libraryIndex.owners.get(songSourceKey((canonical[key(track.ref)] ?? track.ref) as any));
    } catch {
      return undefined;
    }
  };
  const mobileSongForTrack = (track: Track) =>
    !track.songId &&
    ((track.parts?.length ?? 0) > 1 || (partsStore.peek(track.ref.id)?.parts?.length ?? 0) > 1)
      ? undefined
      : libraryIndex.songs.get(songForTrack(track) ?? '');
  const browseTitle = (track: Track) =>
    !desktop ? (mobileSongForTrack(track)?.title ?? displayTitle(track)) : displayTitle(track);
  const browseArtist = (track: Track) =>
    !desktop ? mobileSongForTrack(track)?.artists?.join(' / ') || creator(track) : creator(track);
  const favorite = (t: Track, toggle = true, entryContext: EntryContext = t.songId ? 'part' : 'video') => {
    if (!lib || saving || writeWork.current) return;
    if (
      desktop &&
      favoriteWork.current?.key === key(t.ref) &&
      !favoriteWork.current.controller.signal.aborted
    )
      return;
    if (sourceBlocked(t) && !isFavorite(t)) {
      setError('YouTube 已关闭，请在设置中开启后再收藏。');
      return;
    }
    actionWork.current?.abort();
    const controller = new AbortController();
    actionWork.current = controller;
    setActionBusy(true);
    setError('');
    if (desktop) {
      favoriteWork.current = { key: key(t.ref), controller };
      setFavoriteTarget(key(t.ref));
    }
    void (async () => {
      try {
        const songId = songForTrack(t),
          alreadySaved = !!lib.snapshot.favorites.find((favorite) => favorite.songId === songId);
        const entry =
          !alreadySaved && t.ref.provider === 'bilibili' && (entryContext === 'video' || !t.ref.part)
            ? await partsStore.read(t.ref, controller.signal)
            : t;
        controller.signal.throwIfAborted();
        const resolved = { ...t, ...entry };
        setCanonical((old) => ({ ...old, [key(t.ref)]: entry.ref }));
        if (
          entryContext === 'video' &&
          entry.ref.provider === 'bilibili' &&
          (entry.parts?.length ?? 1) > 1
        ) {
          if (popup?.track?.ref.id === t.ref.id)
            setPopup((old) =>
              old
                ? {
                    ...old,
                    track: resolved,
                    parts: entry.parts,
                    intent: 'favorite',
                    step: (old.step ?? 0) + 1,
                  }
                : old,
            );
          else
            open({ type: 'track', track: resolved, parts: entry.parts, entryContext, intent: 'favorite' });
          return;
        }
        const owner = songForTrack(resolved),
          favorite = lib.snapshot.favorites.find((favorite) => favorite.songId === owner),
          exists = !!favorite;
        if (exists && !toggle) {
          flash('已在我的收藏');
          return;
        }
        const data = await mutate(
          favorite
            ? { edits: [{ type: 'remove-favorite', favoriteId: favorite.favoriteId }] }
            : owner && !resolved.chartContext
              ? { edits: [{ type: 'favorite', songId: owner }] }
              : {
                  save: {
                    refs: [resolved.ref],
                    target: 'favorite',
                    ...(resolved.chartContext ? { context: resolved.chartContext } : {}),
                  },
                },
          false,
        );
        if (data)
          flash(
            exists ? '已取消收藏本首' : '已收藏本首',
            resolved.ref.provider === 'bilibili'
              ? { label: '管理整组', run: () => void showParts(resolved) }
              : undefined,
          );
      } catch (issue) {
        if (!cancelled(issue) && !controller.signal.aborted) setError(errorText(issue));
      } finally {
        if (favoriteWork.current?.controller === controller) {
          favoriteWork.current = undefined;
          setFavoriteTarget(undefined);
        }
        if (actionWork.current === controller) {
          setActionBusy(false);
          actionWork.current = null;
        }
      }
    })();
  };
  const favoritePending = (track: Track) => desktop && favoriteTarget === key(track.ref);
  const isFavorite = (t: Track) => {
    const songId = songForTrack(t);
    return !!songId && libraryIndex.favorites.has(songId);
  };
  const isVideoFavorite = (t: Track) => {
    const parts = partsStore.peek(t.ref.id)?.parts;
    return parts && parts.length > 1 ? parts.every(isFavorite) : isFavorite(t);
  };
  useEffect(() => {
    const c = new AbortController();
    const native = lib?.snapshot.versions.map((version) => version.ref) ?? [];
    const tracks = Object.values(results)
      .flatMap((r) => r.items)
      .filter(
        (t) =>
          t.ref.provider === 'bilibili' &&
          !t.ref.part &&
          !canonical[key(t.ref)] &&
          native.some((r) => r.id === t.ref.id),
      );
    for (const t of tracks)
      void partsStore
        .read(t.ref, c.signal, false)
        .then((e) => setCanonical((old) => ({ ...old, [key(t.ref)]: e.ref })))
        .catch(() => {});
    return () => c.abort();
  }, [lib, results, partsStore]);
  function groupSource(track: Track) {
    if (!requireLibrary()) return;
    closeSearch();
    setPopup(null);
    setGroupTrack(track);
  }
  const playlist = lib?.snapshot.playlists.find((p) => p.id === selected);
  const saveParts = async (
    action: PartBatchAction,
    parts: MusicEntry[],
    options: { playlistId?: string; duplicates?: DuplicatePolicy; name?: string } = {},
  ) => {
    if (parts.length > 500) {
      setError('一次最多处理 500 首，请选择部分分 P。');
      return false;
    }
    const ids = new Set(parts.map(songForTrack));
    const data = await mutate(
      action === 'unfavorite'
        ? {
            edits: lib?.snapshot.favorites
              .filter((favorite) => ids.has(favorite.songId))
              .map((favorite) => ({ type: 'remove-favorite', favoriteId: favorite.favoriteId })),
          }
        : {
            save: {
              refs: parts.map((track) => track.ref),
              target: action === 'favorite' ? 'favorite' : 'playlist',
              ...options,
            },
          },
      false,
    );
    if (data?.summary) {
      const target = options.playlistId
        ? lib?.snapshot.playlists.find((p) => p.id === options.playlistId)?.name
        : options.name;
      flash(
        action === 'unfavorite'
          ? `已取消收藏 ${data.summary.changed} 首`
          : `${target ? '已向「' + target + '」添加' : '已收藏'} ${data.summary.changed} 首，跳过 ${data.summary.unchanged} 首`,
      );
    }
    return !!data;
  };
  const retryWrite = () => {
    void mutate(pending, false);
  };
  const mobilePlaylistTitle =
    selected === favoritesId
      ? '我的收藏'
      : lib?.snapshot.playlists.find((playlist) => playlist.id === selected)?.name;
  return {
    saving,
    pending,
    chartFavoriteAction,
    mutate,
    retryWrite,
    libraryIndex,
    favorite,
    favoritePending,
    isFavorite,
    isVideoFavorite,
    toggleChartFavorite,
    browseTitle,
    browseArtist,
    saveParts,
    importTracks,
    groupSource,
    playlist,
    mobilePlaylistTitle,
  };
}
