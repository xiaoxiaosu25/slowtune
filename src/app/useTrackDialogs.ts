import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MusicClient } from '@studio/music-sources/client';
import type { EntryRef, MusicEntry } from '@studio/music-sources';
import { cancelled, errorText, key, type Track } from '../api';
import type { SongLibraryState } from '../../server/song-library-types';
import type { SongQuery } from '../../server/search-policy';
import { PartMetadataStore, type EntryContext, type MusicActionIntent } from '../multipart';
import type { ListImportRequest } from '../SongListImportPanel';

export type Popup = {
  type: 'new' | 'rename' | 'delete' | 'backup' | 'maintenance' | 'link' | 'parts' | 'track' | 'sleep';
  track?: Track;
  id?: string;
  parts?: MusicEntry[];
  origin?: { tracks: Track[]; index: number };
  entryContext?: EntryContext;
  intent?: MusicActionIntent;
  targetId?: string;
  anchorId?: string;
  session?: number;
  step?: number;
  searchSong?: SongQuery;
};

type DialogOptions = {
  client: MusicClient;
  lib: SongLibraryState | null;
  youtubeEnabled: boolean;
  sourceBlocked: (track: Track) => boolean;
  toggleQueue: () => void;
  enterPlaying: () => void;
  setError: (message: string) => void;
};

export function useTrackDialogs({
  client,
  lib,
  youtubeEnabled,
  sourceBlocked,
  toggleQueue,
  enterPlaying,
  setError,
}: DialogOptions) {
  const [popup, setPopup] = useState<Popup | null>(null);
  const [field, setField] = useState('');
  const [canonical, setCanonical] = useState<Record<string, EntryRef>>({});
  const [partsStore] = useState(() => new PartMetadataStore(client));
  useSyncExternalStore(partsStore.subscribe, partsStore.getVersion);
  const [actionBusy, setActionBusy] = useState(false),
    [metadataBusy, setMetadataBusy] = useState(false),
    [metadataRetry, setMetadataRetry] = useState(0),
    [linkBusy, setLinkBusy] = useState(false);
  const actionWork = useRef<AbortController | null>(null),
    modalSession = useRef(0);
  const [listImport, setListImport] = useState<ListImportRequest>();
  const [groupTrack, setGroupTrack] = useState<Track>();
  const linkWork = useRef<AbortController | null>(null);
  const cancelTrackAction = () => {
    actionWork.current?.abort();
    setActionBusy(false);
  };
  const open = (p: Popup | { type: 'queue' } | { type: 'playing' }) => {
    if (p.type === 'queue') {
      toggleQueue();
      return;
    }
    if (p.type === 'playing') {
      enterPlaying();
      return;
    }
    cancelTrackAction();
    setError('');
    setField(p.type === 'rename' ? (lib?.snapshot.playlists.find((x) => x.id === p.id)?.name ?? '') : '');
    const cached = p.track ? partsStore.peek(p.track.ref.id) : undefined;
    setPopup({
      ...p,
      session: ++modalSession.current,
      ...(p.track
        ? {
            parts: p.parts ?? cached?.parts,
            entryContext: p.entryContext ?? (p.track.songId ? 'part' : 'video'),
          }
        : {}),
    });
  };
  useEffect(() => () => partsStore.dispose(), [partsStore]);
  useEffect(() => {
    if (!popup?.track || !['track', 'parts'].includes(popup.type) || sourceBlocked(popup.track)) {
      setMetadataBusy(false);
      return;
    }
    const controller = new AbortController(),
      session = popup.session;
    setMetadataBusy(true);
    void partsStore
      .read(popup.track.ref, controller.signal)
      .then((entry) => {
        if (controller.signal.aborted) return;
        setCanonical((old) => ({ ...old, [key(popup.track!.ref)]: entry.ref }));
        setPopup((old) =>
          old && old.session === session
            ? { ...old, track: { ...old.track!, ...entry, partsGroupTitle:old.track!.partsGroupTitle ?? old.track!.title }, parts: entry.parts ?? [entry] }
            : old,
        );
      })
      .catch((issue) => {
        if (!cancelled(issue) && !controller.signal.aborted) setError(errorText(issue));
      })
      .finally(() => {
        if (!controller.signal.aborted) setMetadataBusy(false);
      });
    return () => controller.abort();
  }, [
    popup?.session,
    popup?.track?.ref.provider,
    popup?.track?.ref.id,
    popup?.track?.ref.part,
    partsStore,
    metadataRetry,
    youtubeEnabled,
  ]);
  async function showParts(t: Track) {
    actionWork.current?.abort();
    setActionBusy(false);
    setError('');
    const cached = partsStore.peek(t.ref.id);
    setPopup((old) =>
      old?.track?.ref.provider === t.ref.provider && old.track.ref.id === t.ref.id
        ? {
            ...old,
            track: t,
            parts: old.parts ?? cached?.parts,
            intent: 'parts',
            entryContext: 'part',
            step: (old.step ?? 0) + 1,
          }
        : {
            type: 'track',
            track: t,
            parts: cached?.parts,
            intent: 'parts',
            entryContext: 'part',
            session: ++modalSession.current,
          },
    );
  }
  useEffect(
    () => () => {
      linkWork.current?.abort();
      actionWork.current?.abort();
    },
    [client],
  );
  const attachingSong = lib?.snapshot.songs.find((song) => song.id === popup?.track?.targetSongId);
  return {
    popup,
    setPopup,
    field,
    setField,
    canonical,
    setCanonical,
    partsStore,
    actionBusy,
    setActionBusy,
    actionWork,
    metadataBusy,
    setMetadataRetry,
    linkBusy,
    setLinkBusy,
    linkWork,
    listImport,
    setListImport,
    groupTrack,
    setGroupTrack,
    cancelTrackAction,
    open,
    showParts,
    attachingSong,
  };
}
