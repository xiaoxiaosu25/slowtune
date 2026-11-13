import { useEffect, useRef, useState } from 'react';
import type { MusicClient } from '@studio/music-sources/client';
import type { Shelf } from '@studio/music-sources';
import {
  request,
  cancelled,
  errorText,
  type BilibiliAccountState,
  type CreatorProfile,
  type CreatorRef,
  type FollowState,
  type ServerStatus,
  type Track,
} from '../api';
import { initialFollowView } from '../mobile-follow';
import { discoverySize } from '../CatalogView';
import { readYoutubeRegion, youtubeMusicPath } from '../youtube-candidates';
import type { RecommendedShelf } from '../../server/recommendation';
import { bilibiliDiscoveryPath, type StartupPreload } from '../startup';
import { artworkKey, names } from './shared';
import type { useTrackDialogs } from './useTrackDialogs';
import type { useWorkspaceNavigation } from './useWorkspaceNavigation';

type DiscoveryOptions = {
  client: MusicClient;
  preload: StartupPreload;
  desktop: boolean;
  status: ServerStatus | undefined;
  navigation: ReturnType<typeof useWorkspaceNavigation>;
  dialogs: Pick<ReturnType<typeof useTrackDialogs>, 'setPopup' | 'setListImport'>;
  closeSearch: () => void;
  setError: (message: string) => void;
};

export function useWorkspaceDiscovery({
  client,
  preload,
  desktop,
  status,
  navigation,
  dialogs,
  closeSearch,
  setError,
}: DiscoveryOptions) {
  const { page, navigate, setFollowView } = navigation;
  const { setPopup, setListImport } = dialogs;
  const [source, setSource] = useState<keyof typeof names>('all');
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [discoverError, setDiscoverError] = useState<unknown>();
  const [bilibiliAccount, setBilibiliAccount] = useState<BilibiliAccountState>();
  const [followState, setFollowState] = useState<FollowState | null>(null),
    [trackAuthors, setTrackAuthors] = useState<Record<string, CreatorRef>>({});
  const [activeCreator, setActiveCreator] = useState<CreatorProfile>(),
    [authorBusy, setAuthorBusy] = useState(false),
    authorWork = useRef<AbortController | null>(null),
    [authorTarget, setAuthorTarget] = useState('');
  const [discoveryMessage, setDiscoveryMessage] = useState(''),
    [discoveryUpdatedAt, setDiscoveryUpdatedAt] = useState<number>();
  const [youtubeRefresh, setYoutubeRefresh] = useState(0);
  const previousRecommendations = useRef(new Set<string>());
  const discovery = useRef<AbortController | null>(null);
  const cancelAuthor = () => {
    authorWork.current?.abort();
    setAuthorBusy(false);
  };
  const cancelDiscovery = () => {
    discovery.current?.abort();
    setDiscoverBusy(false);
  };
  const openCreator = async (track: Track) => {
    authorWork.current?.abort();
    const controller = new AbortController();
    authorWork.current = controller;
    setAuthorBusy(true);
    setAuthorTarget(artworkKey(track));
    setError('');
    try {
      const profile = await request<CreatorProfile>(
        '/api/creators/resolve',
        { ref: track.ref },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setTrackAuthors((old) => ({
        ...old,
        [artworkKey(track)]: { provider: profile.provider, id: profile.id },
      }));
      setPopup(null);
      closeSearch();
      navigate('follows');
      setSource((previous) =>
        previous === 'all' || previous === profile.provider ? previous : profile.provider,
      );
      setActiveCreator(profile);
      setFollowView({ ...initialFollowView, selected: profile });
    } catch (e) {
      if (!cancelled(e) && !controller.signal.aborted) setError(errorText(e));
    } finally {
      if (authorWork.current === controller) setAuthorBusy(false);
    }
  };
  // 设置页会卸载发现栏目；保存规则后准备新批次，返回时读取该批次。
  const refreshYoutubeCandidates = async () => {
    if (!status?.providers.youtube.available) return;
    try {
      await request(youtubeMusicPath(readYoutubeRegion(), { refresh: true }));
    } catch {
      /* 候选池补取失败时，随后的预览／保存会把原因报给用户。 */
    }
  };
  const checkAccount = async (signal?: AbortSignal) => {
    try {
      const data = await preload.take<BilibiliAccountState>('/api/bilibili/account', signal);
      if (!signal?.aborted) setBilibiliAccount(data);
    } catch (e) {
      if (!cancelled(e)) setBilibiliAccount({ state: 'unavailable', issue: errorText(e) });
    }
  };
  const discover = async (refresh = false) => {
    discovery.current?.abort();
    const c = new AbortController();
    discovery.current = c;
    setDiscoverBusy(refresh || !shelves.length);
    setDiscoverError(undefined);
    try {
      const data = await preload.take<RecommendedShelf[]>(
        bilibiliDiscoveryPath(refresh, desktop),
        c.signal,
      );
      if (!c.signal.aborted) {
        setShelves((old) =>
          data
            .filter((s) => s.kind === 'recommendation')
            .map((next) =>
              next.error && old.find((s) => s.id === next.id)?.page
                ? old.find((s) => s.id === next.id)!
                : next,
            ),
        );
        if (data.some((s) => s.error)) setDiscoverError(data.find((s) => s.error)!.error);
        const recommended = data.find((s) => s.kind === 'recommendation');
        if (recommended?.page && !recommended.error) {
          const items = recommended.page.items.slice(0, discoverySize),
            newCount = items.filter((t) => !previousRecommendations.current.has(t.ref.id)).length;
          setDiscoveryMessage(
            items.length
              ? refresh && previousRecommendations.current.size
                ? newCount
                  ? `本次找到 ${newCount} 首新音乐`
                  : 'B站本次返回相同的音乐，可再换一批'
                : '当前批次 ' + items.length + ' 首音乐'
              : '本次没有找到音乐，可再换一批',
          );
          previousRecommendations.current = new Set(items.map((t) => t.ref.id));
          setDiscoveryUpdatedAt(recommended.recommendation?.fetchedAt ?? Date.now());
          if (recommended.recommendation?.issue)
            setDiscoverError({
              code: recommended.recommendation.issue,
              retained: recommended.recommendation.retained,
            });
        }
        if (refresh) void checkAccount(c.signal);
      }
    } catch (e) {
      if (!cancelled(e) && !c.signal.aborted) {
        setDiscoverError(
          (e as { code?: string }).code === 'authentication' ? { code: 'bilibili-authentication' } : e,
        );
        if ((e as { code?: string }).code === 'authentication') {
          setShelves([]);
          void checkAccount(c.signal);
        }
      }
    } finally {
      if (discovery.current === c) setDiscoverBusy(false);
    }
  };
  const accountChanged = (value: BilibiliAccountState) => {
    setBilibiliAccount(value);
    setShelves([]);
    previousRecommendations.current.clear();
    setDiscoveryMessage('');
    setDiscoveryUpdatedAt(undefined);
    void discover();
  };
  const recommendationChanged = (column: string) => {
    if (column === 'youtube-music-selection') {
      void refreshYoutubeCandidates();
      setYoutubeRefresh((value) => value + 1);
      return;
    }
    discovery.current?.abort();
    setShelves((old) =>
      old.map((s) => (s.id === column ? { ...s, page: undefined, error: undefined } : s)),
    );
    void discover(true);
  };
  useEffect(() => {
    const c = new AbortController();
    void checkAccount(c.signal);
    return () => c.abort();
  }, [client]);
  useEffect(() => {
    setListImport(undefined);
  }, [bilibiliAccount?.state, bilibiliAccount?.account?.id]);
  useEffect(() => {
    const c = new AbortController();
    void preload
      .take<FollowState>('/api/follows', c.signal)
      .then((value) => {
        if (!c.signal.aborted) setFollowState(value);
      })
      .catch(() => {});
    return () => c.abort();
  }, [client]);
  useEffect(() => {
    void discover();
    return () => discovery.current?.abort();
  }, [client]);
  const discoveryPreparing = shelves.some((s) => (s as RecommendedShelf).recommendation?.updating);
  useEffect(() => {
    if (!discoveryPreparing || discoverBusy || page !== 'discover') return;
    const timer = setTimeout(() => void discover(), 3000);
    return () => clearTimeout(timer);
  }, [discoveryPreparing, discoverBusy, shelves, page]);
  const filteredShelves = shelves.map((s) => ({
    ...s,
    page: s.page
      ? { ...s.page, items: s.page.items.filter((t) => source === 'all' || t.ref.provider === source) }
      : undefined,
  }));
  const discoveryShelves =
    desktop && !filteredShelves.length
      ? [{ id: 'music-recommendation', title: 'B站推荐', kind: 'recommendation' } as Shelf]
      : filteredShelves;
  return {
    source,
    setSource,
    shelves,
    discoverBusy,
    discoverError,
    discover,
    discoveryShelves,
    cancelDiscovery,
    bilibiliAccount,
    accountChanged,
    recommendationChanged,
    discoveryMessage,
    discoveryUpdatedAt,
    youtubeRefresh,
    followState,
    setFollowState,
    trackAuthors,
    setTrackAuthors,
    activeCreator,
    setActiveCreator,
    authorBusy,
    setAuthorBusy,
    authorWork,
    authorTarget,
    cancelAuthor,
    openCreator,
  };
}
