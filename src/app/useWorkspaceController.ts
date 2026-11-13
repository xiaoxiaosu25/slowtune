import { useEffect, useRef, useState } from 'react';
import type { MusicClient } from '@studio/music-sources/client';
import { errorText, request, type ServerStatus } from '../api';
import type { StartupPreload } from '../startup';
import { readMobileNavigationPage } from '../useMobileNavigationHistory';
import { useDesktopSongCatalog } from '../use-desktop-song-catalog';
import { useMediaQuery } from './useMediaQuery';
import { useLibraryData } from './useLibraryData';
import { useLibraryActions } from './useLibraryActions';
import { useSourceSettings } from './useSourceSettings';
import { useSearchState } from './useSearchState';
import { useTrackDialogs } from './useTrackDialogs';
import { useWorkspaceDiscovery } from './useWorkspaceDiscovery';
import { useWorkspaceNavigation } from './useWorkspaceNavigation';
import { useWorkspacePlayback } from './useWorkspacePlayback';
import { useWorkspaceSearch } from './useWorkspaceSearch';

type WorkspaceOptions = { client: MusicClient; preload: StartupPreload; onLogout: () => void };

export function useWorkspaceController({ client, preload, onLogout }: WorkspaceOptions) {
  const desktop = useMediaQuery('(min-width:761px)');
  const [initialMobileRoute] = useState(() => (desktop ? 'discover' : readMobileNavigationPage()));
  const [status, setStatus] = useState<ServerStatus>();
  const [statusCheckedAt, setStatusCheckedAt] = useState<number>();
  const [online, setOnline] = useState(navigator.onLine);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [noticeAction, setNoticeAction] = useState<{ label: string; run: () => void }>();
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flash = (t: string, action?: { label: string; run: () => void }) => {
    setNotice(t);
    setNoticeAction(action);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(
      () => {
        setNotice('');
        setNoticeAction(undefined);
      },
      action ? 7000 : 3500,
    );
  };
  const library = useLibraryData(preload, desktop, client);
  const { lib, rawLibrary, readLibrary, updateLibrary } = library;
  const sourceSettings = useSourceSettings(client, status, setStatus);
  const { sources, sourceStateRef, sourcesChanged, youtubeEnabled, youtubeAvailable, sourceBlocked } =
    sourceSettings;
  const searchState = useSearchState(
    client,
    sourceStateRef,
    youtubeEnabled,
    initialMobileRoute === 'search',
  );
  const { setSearchSource, youtubeSearch, setResults, linkRef, search, setLinkRef } = searchState;
  const refreshDiagnostics = async () => {
    const value = await preload.take<ServerStatus>('/api/status');
    setStatus(value);
    setStatusCheckedAt(Date.now());
    if (value.sourceSettings) sourcesChanged(value.sourceSettings);
  };
  const reload = async () => {
    try {
      await Promise.all([readLibrary(), refreshDiagnostics()]);
    } catch (e) {
      setError(errorText(e));
    }
  };
  // Navigation calls these actions only from event handlers, after all domains have been initialized.
  const navigation = useWorkspaceNavigation({
    desktop,
    initialMobileRoute,
    searchState,
    reload,
    cancelTrackAction: () => dialogs.cancelTrackAction(),
    closePopup: () => dialogs.setPopup(null),
    cancelAuthor: () => discovery.cancelAuthor(),
    clearCreator: () => discovery.setActiveCreator(undefined),
    cancelDiscovery: () => discovery.cancelDiscovery(),
    openSearch: () => searchActions.openSearch(),
    closeSearch: () => searchActions.closeSearch(),
  });
  const dialogs = useTrackDialogs({
    client,
    lib,
    youtubeEnabled,
    sourceBlocked,
    setError,
    toggleQueue: navigation.toggleQueue,
    enterPlaying: navigation.enterPlaying,
  });
  const discovery = useWorkspaceDiscovery({
    client,
    preload,
    desktop,
    status,
    navigation,
    dialogs,
    closeSearch: () => searchActions.closeSearch(),
    setError,
  });
  const searchActions = useWorkspaceSearch({
    client,
    desktop,
    youtubeAvailable,
    searchState,
    navigation,
    dialogs,
    discovery,
    setError,
  });
  const libraryActions = useLibraryActions({
    client,
    desktop,
    library,
    navigation,
    dialogs,
    results: searchState.results,
    sourceBlocked,
    closeSearch: searchActions.closeSearch,
    flash,
    setError,
  });
  const listening = useWorkspacePlayback({
    client,
    desktop,
    library,
    sourceSettings,
    navigation,
    dialogs,
    discovery,
    searchState,
    searchForTitle: searchActions.searchForTitle,
    flash,
    setError,
  });
  const { playback, snapshot, preparingPlayback } = listening;
  const {
    setSource,
    activeCreator,
    setActiveCreator,
    authorWork,
    setAuthorBusy,
    bilibiliAccount,
    accountChanged,
    recommendationChanged,
  } = discovery;
  const { open, popup, actionWork, setActionBusy } = dialogs;
  const logout = async () => {
    // Release sources while the session is valid; keep the engine usable if the
    // network request fails. Successful logout disposes it when Workspace unmounts.
    if ((await playback.stop()) === false) throw new Error('stop-failed');
    await request('/api/logout', {});
    onLogout();
  };
  useDesktopSongCatalog(
    desktop && !!rawLibrary,
    () => readLibrary(undefined, true),
    !!rawLibrary &&
      (rawLibrary.snapshot.songs.length >= 1000 || rawLibrary.snapshot.versions.length >= 4000) &&
      (snapshot.playing || preparingPlayback),
  );
  useEffect(() => {
    if (youtubeEnabled) return;
    setSource('all');
    setSearchSource('all');
    youtubeSearch.current?.abort();
    setResults((old) =>
      Object.fromEntries(Object.entries(old).filter(([provider]) => provider !== 'youtube')),
    );
    if (linkRef?.provider === 'youtube') {
      search.current?.abort();
      setLinkRef(undefined);
    }
    if (activeCreator?.provider === 'youtube') setActiveCreator(undefined);
    if (popup?.track?.ref.provider === 'youtube') {
      actionWork.current?.abort();
      authorWork.current?.abort();
      setActionBusy(false);
      setAuthorBusy(false);
    }
  }, [youtubeEnabled]);
  useEffect(() => {
    void reload();
    const network = () => setOnline(navigator.onLine);
    window.addEventListener('online', network);
    window.addEventListener('offline', network);
    return () => {
      clearTimeout(noticeTimer.current);
      window.removeEventListener('online', network);
      window.removeEventListener('offline', network);
    };
  }, [client]);
  const settingsProps = {
    onLibraryChange: updateLibrary,
    onSearchPreferencesChanged: searchState.searchPreferencesChanged,
    status,
    statusCheckedAt,
    onRefreshDiagnostics: refreshDiagnostics,
    sources,
    onSourcesChanged: sourcesChanged,
    account: bilibiliAccount,
    library: lib,
    onAccountChange: accountChanged,
    onRecommendationChanged: recommendationChanged,
    onReload: () => void reload(),
    onOpenBackup: () => open({ type: 'backup' }),
    onStopPlayback: () => playback.stop(),
    onLogout: logout,
  };
  return {
    ...sourceSettings,
    ...library,
    ...navigation,
    ...dialogs,
    ...discovery,
    ...searchState,
    ...searchActions,
    ...libraryActions,
    ...listening,
    client,
    onLogout,
    desktop,
    status,
    build: status?.build,
    error,
    setError,
    notice,
    noticeAction,
    flash,
    online,
    reload,
    settingsProps,
  };
}

export type WorkspaceController = ReturnType<typeof useWorkspaceController>;
