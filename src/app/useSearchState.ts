import { useRef, useState, type MutableRefObject } from 'react';
import type { MusicClient } from '@studio/music-sources/client';
import type { EntryRef, SearchOrder } from '@studio/music-sources';
import { request, type Track } from '../api';
import type { ChartSongContext } from '../../server/song-library-types';
import { preferredSong, searchPreferredVersions, type PreferredSong, type SearchConfig, type SearchPage, type SearchSettings, type SongQuery } from '../../server/search-policy';
import type { SourceSettingsState } from '../source-settings';
import type { names } from './shared';

export type SearchProvider = 'bilibili' | 'youtube';
export type SearchSource = keyof typeof names;
export type SearchResult = {
  items: Track[];
  cursor?: string;
  error?: unknown;
  busy?: boolean;
  config?: SearchConfig;
  preferred?: PreferredSong;
  preferredVersions?: PreferredSong[];
  classificationIssue?: SearchPage['classificationIssue'];
};

/**
 * 搜索的状态与请求：查询词、各来源结果、分页、排序和目标歌曲。
 * 打开／关闭搜索页与导航的衔接仍由工作区负责。
 */
export function useSearchState(client: MusicClient, sourceStateRef: MutableRefObject<SourceSettingsState | undefined>, youtubeEnabled: boolean, initiallyOpen: boolean) {
  const [searchOpen, setSearchOpen] = useState(initiallyOpen);
  const [searchSource, setSearchSource] = useState<SearchSource>('all');
  const [searchType, setSearchType] = useState<'video' | 'users'>('video');
  const [searchOrder, setSearchOrder] = useState<SearchOrder>('relevance');
  const [creatorOrder, setCreatorOrder] = useState<'relevance' | 'followers'>('relevance');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [results, setResults] = useState<Record<string, SearchResult>>({});
  const [linkRef, setLinkRef] = useState<EntryRef>();
  const [searchSong, setSearchSong] = useState<SongQuery>();
  const [showAllSearch, setShowAllSearch] = useState<boolean>();
  const search = useRef<AbortController | null>(null);
  const youtubeSearch = useRef<AbortController | null>(null);
  const searchTarget = useRef<{ context?: ChartSongContext; songId?: string }>({});
  const searchReturn = useRef<(() => void) | undefined>(undefined);
  const searchSettingsEpoch = useRef(0);
  const latestSearchSettings = useRef<SearchSettings | undefined>(undefined);

  /** 停止所有来源的加载状态，保留已取得的结果。 */
  const settleResults = () => setResults(old => Object.fromEntries(Object.entries(old).map(([p, r]) => [p, { ...r, busy: false }])));

  const searchPreferencesChanged = (state: SearchSettings) => {
    searchSettingsEpoch.current++;
    latestSearchSettings.current = state;
    const song = searchSong ?? { title: searched };
    setResults(old => Object.fromEntries(Object.entries(old).map(([provider, result]) => [provider, {
      ...result,
      config: state.config,
      preferred: preferredSong(state.preferred, song),
      preferredVersions: searchPreferredVersions(state.preferred, song),
    }])));
  };

  async function find(provider: SearchProvider, text: string, c: AbortController, cursor?: string, ref?: EntryRef, song: SongQuery = searchSong ?? { title: text }, order: SearchOrder = searchOrder) {
    const target = searchTarget.current;
    const youtubeOn = () => sourceStateRef.current?.youtube.enabled ?? youtubeEnabled;
    if (c.signal.aborted || provider === 'youtube' && !youtubeOn()) return;
    const controller = provider === 'youtube' ? new AbortController() : c, abort = () => controller.abort(), settingsEpoch = searchSettingsEpoch.current;
    if (provider === 'youtube') {
      youtubeSearch.current?.abort();
      youtubeSearch.current = controller;
      c.signal.addEventListener('abort', abort, { once: true });
    }
    const active = () => !c.signal.aborted && !controller.signal.aborted && (provider !== 'youtube' || youtubeOn());
    setResults(old => active() ? { ...old, [provider]: { ...(cursor ? old[provider] ?? { items: [] } : { items: [] }), busy: true, error: undefined } } : old);
    try {
      const data = ref
        ? await client.list({ ref, limit: 20, cursor }, { signal: controller.signal })
        : await request<SearchPage>('/api/search', { provider, query: text, cursor, song, ...(provider === 'bilibili' ? { order } : {}) }, controller.signal);
      const changed = settingsEpoch !== searchSettingsEpoch.current ? latestSearchSettings.current : undefined;
      const searchData = ref ? undefined : {
        ...data as SearchPage,
        ...(changed ? { config: changed.config, preferred: preferredSong(changed.preferred, song), preferredVersions: searchPreferredVersions(changed.preferred, song) } : {}),
      };
      if (active()) setResults(old => {
        if (!active() || !old[provider]) return old;
        const incoming = data.items.map(track => ({ ...track, ...(target.context ? { chartContext: target.context } : {}), ...(target.songId ? { targetSongId: target.songId } : {}) }));
        const entries = cursor ? [...old[provider].items, ...incoming] : incoming;
        return { ...old, [provider]: {
          items: [...new Map(entries.map(t => [t.resourceId, t])).values()],
          cursor: data.nextCursor,
          ...(searchData ? { config: searchData.config, preferred: searchData.preferred, preferredVersions: searchData.preferredVersions, classificationIssue: searchData.classificationIssue } : {}),
        } };
      });
    } catch (e) {
      if (active()) setResults(old => active() && old[provider] ? { ...old, [provider]: { ...old[provider], busy: false, error: e } } : old);
    } finally {
      if (provider === 'youtube') c.signal.removeEventListener('abort', abort);
    }
  }

  const loadMore = (p: SearchProvider) => {
    const c = search.current && !search.current.signal.aborted ? search.current : new AbortController();
    search.current = c;
    return find(p, searched, c, results[p]?.cursor, linkRef);
  };

  return {
    searchOpen, setSearchOpen, searchSource, setSearchSource, searchType, setSearchType, searchOrder, setSearchOrder,
    creatorOrder, setCreatorOrder, query, setQuery, searched, setSearched, results, setResults, linkRef, setLinkRef,
    searchSong, setSearchSong, showAllSearch, setShowAllSearch,
    search, youtubeSearch, searchTarget, searchReturn, settleResults, searchPreferencesChanged, find, loadMore,
  };
}
