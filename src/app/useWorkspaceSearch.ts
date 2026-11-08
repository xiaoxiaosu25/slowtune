import { useEffect, useRef } from 'react';
import type { EntryRef, MusicEntry, SearchOrder } from '@studio/music-sources';
import { cancelled, errorText, request, type CreatorProfile, type Track } from '../api';
import { initialFollowView } from '../mobile-follow';
import { useCreatorSearch } from '../CreatorSearch';
import type { EntryContext } from '../multipart';
import type { ChartSongContext, Song } from '../../server/song-library-types';
import { songSearchText, type SongQuery } from '../../server/search-policy';
import type { names } from './shared';
import type { useSearchState } from './useSearchState';
import type { useTrackDialogs } from './useTrackDialogs';
import type { useWorkspaceDiscovery } from './useWorkspaceDiscovery';
import type { useWorkspaceNavigation } from './useWorkspaceNavigation';

type SearchOptions = {
  client: unknown;
  desktop: boolean;
  youtubeAvailable: boolean;
  searchState: ReturnType<typeof useSearchState>;
  navigation: ReturnType<typeof useWorkspaceNavigation>;
  dialogs: ReturnType<typeof useTrackDialogs>;
  discovery: ReturnType<typeof useWorkspaceDiscovery>;
  setError: (message: string) => void;
};

export function useWorkspaceSearch({
  client,
  desktop,
  youtubeAvailable,
  searchState,
  navigation,
  dialogs,
  discovery,
  setError,
}: SearchOptions) {
  const {
    searchOpen,
    setSearchOpen,
    searchSource,
    setSearchSource,
    searchType,
    setSearchType,
    searchOrder,
    setSearchOrder,
    creatorOrder,
    setCreatorOrder,
    query,
    setQuery,
    searched,
    setSearched,
    results,
    setResults,
    setLinkRef,
    searchSong,
    setSearchSong,
    setShowAllSearch,
    search,
    searchTarget,
    searchReturn,
    settleResults,
    find,
  } = searchState;
  const { page, navigate, searchOrigin, revealSearch, setCreatorFromSearch, setFollowView } = navigation;
  const { cancelTrackAction, field, linkWork, setLinkBusy, setPopup, partsStore, open } = dialogs;
  const { cancelAuthor, setSource, setActiveCreator } = discovery;
  const serial = useRef(0);
  const creatorSearch = useCreatorSearch();
  useEffect(() => {
    if (!searchOpen) creatorSearch.cancel();
  }, [searchOpen]);
  useEffect(() => () => search.current?.abort(), [client]);
  function openSearch() {
    searchReturn.current?.();
    searchReturn.current = undefined;
    searchTarget.current = {};
    cancelAuthor();
    search.current?.abort();
    creatorSearch.clear();
    setSearchType('video');
    setSearchOrder('relevance');
    setCreatorOrder('relevance');
    setSearchSource('all');
    setQuery('');
    setSearched('');
    setSearchSong(undefined);
    setShowAllSearch(undefined);
    setLinkRef(undefined);
    setResults({});
    revealSearch();
  }
  function closeSearch() {
    search.current?.abort();
    creatorSearch.cancel();
    cancelTrackAction();
    setSearchOpen(false);
    if (!desktop && page === 'search') navigate(searchOrigin.current);
    settleResults();
    const back = searchReturn.current;
    searchReturn.current = undefined;
    back?.();
  }
  async function searchFor(
    text = query,
    filter: keyof typeof names = searchSource,
    song?: SongQuery,
    preserveDisplay = false,
    context?: ChartSongContext,
    targetSong?: Song,
    order: SearchOrder = searchOrder,
  ) {
    creatorSearch.cancel();
    setSearchType('video');
    if (
      !preserveDisplay &&
      !(desktop && searchReturn.current && searchTarget.current.songId && !targetSong)
    )
      searchTarget.current = {
        ...(context ? { context } : {}),
        ...(targetSong ? { songId: targetSong.id } : {}),
      };
    if (!text.trim()) {
      if (desktop && searchReturn.current && searchTarget.current.songId) {
        search.current?.abort();
        setQuery('');
        setSearched('');
        setResults({});
        setError('');
        return;
      }
      openSearch();
      return;
    }
    cancelAuthor();
    search.current?.abort();
    const c = new AbortController();
    search.current = c;
    serial.current++;
    revealSearch();
    setSearchSource(filter);
    setSearched(text);
    setLinkRef(undefined);
    setResults({});
    const target = song ?? { title: text };
    setSearchSong(target);
    if (!preserveDisplay) setShowAllSearch(undefined);
    const providers = (filter === 'all' ? ['bilibili', 'youtube'] : [filter]).filter(
      (p) => p !== 'youtube' || youtubeAvailable,
    );
    await Promise.all(
      providers.map((p) => find(p as 'bilibili' | 'youtube', text, c, undefined, undefined, target, order)),
    );
  }
  function submitSearch() {
    if (searchType === 'video') {
      void searchFor();
      return;
    }
    const text = query.trim();
    search.current?.abort();
    setSearched(text);
    setLinkRef(undefined);
    if (text !== searched.trim()) {
      setSearchSong(text ? { title: text } : undefined);
      searchTarget.current = {};
      setShowAllSearch(undefined);
      setResults({});
    }
    if (text) void creatorSearch.search(text, 1, creatorOrder);
    else creatorSearch.clear();
  }
  function changeSearchType(next: 'video' | 'users') {
    if (next === searchType) return;
    search.current?.abort();
    creatorSearch.cancel();
    setSearchType(next);
    settleResults();
    if (next === 'users' && searched) void creatorSearch.search(searched, 1, creatorOrder);
    if (next === 'video' && searched) void searchFor(searched, searchSource, searchSong, true);
  }
  function changeSearchOrder(order: SearchOrder) {
    setSearchOrder(order);
    if (searched) void searchFor(searched, searchSource, searchSong, true, undefined, undefined, order);
  }
  function openSearchCreator(profile: CreatorProfile) {
    search.current?.abort();
    creatorSearch.cancel();
    setSearchOpen(false);
    navigate('follows');
    setCreatorFromSearch(true);
    setSource('bilibili');
    setActiveCreator(profile);
    setFollowView({ ...initialFollowView, selected: profile, view: 'videos' });
  }
  function searchForTitle(value: string | (SongQuery & { context?: ChartSongContext })) {
    const song = typeof value === 'string' ? { title: value } : value,
      text = desktop ? songSearchText(song) : song.title;
    setQuery(desktop ? text : '');
    void searchFor(
      text,
      'all',
      { title: song.title, ...(song.artists?.length ? { artists: song.artists } : {}) },
      false,
      'context' in song ? song.context : undefined,
    );
  }
  function searchForLibrarySong(song?: Song, onReturn?: () => void) {
    if (!song) {
      openSearch();
      return;
    }
    searchReturn.current = onReturn;
    const text = desktop ? songSearchText(song) : song.title;
    if (desktop) setQuery(text);
    void searchFor(text, 'all', { title: song.title, artists: song.artists }, false, undefined, song);
  }
  async function resolveLink() {
    linkWork.current?.abort();
    const controller = new AbortController();
    linkWork.current = controller;
    setError('');
    setLinkBusy(true);
    const input = field.trim();
    let entryContext: EntryContext = 'video';
    try {
      if (new URL(input).searchParams.has('p')) entryContext = 'part';
    } catch {}
    try {
      const data = await request<{ entry?: Track; parts?: MusicEntry[]; ref?: EntryRef }>(
        '/api/identify',
        { input },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      if (data.ref) {
        search.current?.abort();
        creatorSearch.cancel();
        setSearchType('video');
        const searchController = new AbortController();
        search.current = searchController;
        setLinkRef(data.ref);
        setSearched('公开歌单');
        setQuery('');
        setSearchSource(data.ref.provider);
        revealSearch();
        setResults({});
        setPopup(null);
        await find(data.ref.provider, '', searchController, undefined, data.ref);
      } else if (data.entry) {
        partsStore.seed(data.entry);
        open({
          type: 'track',
          track: data.entry,
          parts: data.parts ?? [data.entry],
          entryContext,
          intent: (data.parts?.length ?? 1) > 1 ? 'parts' : 'overview',
        });
      }
    } catch (issue) {
      if (!cancelled(issue) && !controller.signal.aborted) setError(errorText(issue));
    } finally {
      if (linkWork.current === controller) {
        setLinkBusy(false);
        linkWork.current = null;
      }
    }
  }
  const pinnedSearch = [
    ...new Map(
      Object.values(results)
        .flatMap((result) => result.preferredVersions ?? [])
        .filter((item) => searchSource === 'all' || item.entry.ref.provider === searchSource)
        .map((item) => [item.key, item]),
    ).values(),
  ];
  return {
    serial,
    creatorSearch,
    openSearch,
    closeSearch,
    searchFor,
    submitSearch,
    changeSearchType,
    changeSearchOrder,
    openSearchCreator,
    searchForTitle,
    searchForLibrarySong,
    resolveLink,
    pinnedSearch,
  };
}
