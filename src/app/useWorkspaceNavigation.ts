import { useEffect, useRef, useState } from 'react';
import { mobilePlaylistId, mobilePlaylistRoute } from '../mobile-library';
import {
  initialFollowView,
  mobileFollowRoute,
  readMobileFollowView,
  type FollowView,
} from '../mobile-follow';
import { useMobileNavigationHistory } from '../useMobileNavigationHistory';
import { OPEN_LAYER } from '../ui/layers';
import { useMobilePageOpen, useMobilePagesSuspended } from '../mobile-pages';
import { mobileSettingsRoute, mobileSettingsSection, type MobileSettingsSection } from '../mobile-settings';
import { useDesktopWindowMode } from '../desktop-chrome';
import { favoritesId } from './shared';
import { useMediaQuery } from './useMediaQuery';
import type { useSearchState } from './useSearchState';

type NavigationOptions = {
  desktop: boolean;
  initialMobileRoute: string;
  searchState: ReturnType<typeof useSearchState>;
  cancelTrackAction: () => void;
  cancelAuthor: () => void;
  clearCreator: () => void;
  cancelDiscovery: () => void;
  openSearch: () => void;
  closeSearch: () => void;
  reload: () => Promise<void>;
  closePopup: () => void;
};

export function useWorkspaceNavigation({
  desktop,
  initialMobileRoute,
  searchState,
  cancelTrackAction,
  cancelAuthor,
  clearCreator,
  cancelDiscovery,
  openSearch,
  closeSearch,
  reload,
  closePopup,
}: NavigationOptions) {
  const { searchOpen, setSearchOpen, searchReturn, search, settleResults } = searchState;
  const mobilePageOpen = useMobilePageOpen(),
    pagesSuspended = useMobilePagesSuspended();
  const [page, setPage] = useState(
    mobileSettingsSection(initialMobileRoute)
      ? 'settings'
      : mobilePlaylistId(initialMobileRoute)
        ? 'playlist'
        : readMobileFollowView(initialMobileRoute)
          ? 'follows'
          : initialMobileRoute,
  );
  const [selected, setSelected] = useState<string>(
    () => mobilePlaylistId(initialMobileRoute) ?? favoritesId,
  );
  const [followView, setFollowView] = useState(
    () => readMobileFollowView(initialMobileRoute) ?? initialFollowView,
  );
  const [creatorFromSearch, setCreatorFromSearch] = useState(false);
  useEffect(() => {
    if (page !== 'follows') setCreatorFromSearch(false);
  }, [page]);
  const [queueOpen, setQueueOpen] = useState(false),
    [listFilter, setListFilter] = useState(''),
    [previousPage, setPreviousPage] = useState('discover');
  const [listeningReturnPage, setListeningReturnPage] = useState('discover');
  const listeningReturnScroll = useRef(0);
  const [mobileSongId, setMobileSongId] = useState<string>();
  const [mobileSection, setMobileSection] = useState<MobileSettingsSection>(
    () => mobileSettingsSection(initialMobileRoute) ?? 'appearance',
  );
  const [mobileSettingsOpened, setMobileSettingsOpened] = useState(
    () => !!mobileSettingsSection(initialMobileRoute),
  );
  const layoutWasDesktop = useRef(desktop);
  const searchOrigin = useRef('discover');
  const mobileBrowsePage = page === 'playing' ? listeningReturnPage : page;
  const playlistOrigin = mobileBrowsePage === 'search' ? searchOrigin.current : mobileBrowsePage;
  // Keep playlist editors mounted while the breakpoint effect converts the page name.
  const playlistPage =
    page === 'playlist' ||
    (page === 'library' && (desktop || layoutWasDesktop.current)) ||
    (!desktop && !!mobilePlaylistId(playlistOrigin));
  const mobileRoute =
    page === 'settings'
      ? mobileSettingsRoute(mobileSection)
      : page === 'follows' && !desktop
        ? mobileFollowRoute(followView)
        : page === 'playlist' || (!desktop && layoutWasDesktop.current && page === 'library')
          ? mobilePlaylistRoute(selected)
          : page;
  const [desktopSettingsRequest, setDesktopSettingsRequest] = useState(0);
  const [listeningPanel, setListeningPanel] = useState<'queue' | 'comments'>('queue');
  const [desktopLyrics, setDesktopLyrics] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const versionsVisible = desktop && page === 'playing' && versionsOpen;
  const desktopLyricsOpen = desktop && page === 'playing' && desktopLyrics;
  useDesktopWindowMode(desktopLyricsOpen ? 'immersive' : 'standard');
  const lyricToggleOrigin = useRef<HTMLElement | null>(null);
  const closeDesktopLyrics = () => {
    setDesktopLyrics(false);
    requestAnimationFrame(() => {
      const origin = lyricToggleOrigin.current;
      if (origin?.isConnected && origin.getClientRects().length) origin.focus({ preventScroll: true });
    });
  };
  const toggleDesktopLyrics = () => {
    if (desktopLyricsOpen) closeDesktopLyrics();
    else {
      lyricToggleOrigin.current = document.activeElement as HTMLElement;
      setDesktopLyrics(true);
    }
  };
  useEffect(() => {
    if (desktop) {
      if (page === 'profile') setPage('settings');
      if (page === 'playlist') setPage('library');
      if (page === 'search') {
        const origin = searchOrigin.current,
          section = mobileSettingsSection(origin),
          playlistId = mobilePlaylistId(origin),
          follow = readMobileFollowView(origin);
        if (section) setMobileSection(section);
        if (playlistId) setSelected(playlistId);
        if (follow) setFollowView(follow);
        setPage(
          section || origin === 'profile'
            ? 'settings'
            : playlistId
              ? 'library'
              : follow
                ? 'follows'
                : origin === 'search'
                  ? 'discover'
                  : origin,
        );
      }
      if (previousPage === 'profile') setPreviousPage('discover');
      setMobileSongId(undefined);
    } else if (layoutWasDesktop.current) {
      if (searchOpen) {
        searchOrigin.current = page === 'library' ? mobilePlaylistRoute(selected) : mobileRoute;
        setPage('search');
      } else if (page === 'library') setPage('playlist');
    }
    layoutWasDesktop.current = desktop;
  }, [desktop, page, previousPage]);
  useEffect(() => {
    if (!desktop && page === 'settings') setMobileSettingsOpened(true);
  }, [desktop, page]);
  useEffect(() => {
    if (!desktop || page !== 'playing') setDesktopLyrics(false);
  }, [desktop, page]);
  useEffect(() => {
    if (!desktopLyricsOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector(OPEN_LAYER)
      ) {
        event.preventDefault();
        closeDesktopLyrics();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [desktopLyricsOpen]);
  const compactQueue = useMediaQuery('(max-width:1050px)');
  const queueVisible = queueOpen;
  const closeQueue = () => setQueueOpen(false);
  const navigate = (route: string, restoring = false) => {
    if (route === 'search') {
      if (!desktop && restoring) {
        setSearchOpen(true);
        setPage('search');
      } else openSearch();
      return;
    }
    if (!desktop && searchOpen) {
      const back = searchReturn.current;
      searchReturn.current = undefined;
      back?.();
      search.current?.abort();
      setSearchOpen(false);
      settleResults();
    }
    const section = mobileSettingsSection(route),
      playlistId = mobilePlaylistId(route),
      follow = readMobileFollowView(route),
      next = section
        ? 'settings'
        : playlistId
          ? desktop
            ? 'library'
            : 'playlist'
          : follow
            ? 'follows'
            : route;
    if (section) {
      setMobileSection(section);
      setMobileSettingsOpened(true);
    }
    if (playlistId) setSelected(playlistId);
    if (follow)
      setFollowView((old) =>
        desktop && route === 'follows'
          ? { ...old, selected: undefined, collection: undefined, view: 'collections' }
          : follow,
      );
    cancelTrackAction();
    cancelAuthor();
    if (next === 'follows') clearCreator();
    if (next !== 'discover' && next !== 'settings') cancelDiscovery();
    setPage(next);
    setListFilter('');
    if (desktop) window.scrollTo(0, 0);
  };
  const mobileBack = useMobileNavigationHistory(!desktop, mobileRoute, (route) => navigate(route, true));
  const openSettings = () => {
    if (page === 'settings') {
      void reload();
      return;
    }
    setPreviousPage(page);
    navigate('settings');
  };
  const openMobileSettings = (id: MobileSettingsSection) => {
    setPreviousPage('profile');
    navigate(mobileSettingsRoute(id));
  };
  const returnFromMobileSettings = () =>
    mobileBack(
      (route) => route === 'profile' || !!mobileSettingsSection(route),
      () => navigate(mobileSection === 'welcome' ? mobileSettingsRoute('appearance') : 'profile'),
    );
  const returnFromMobileFollow = () => {
    if (creatorFromSearch && !followView.collection) {
      mobileBack('search', () => {
        setSearchOpen(true);
        setPage('search');
      });
      return;
    }
    const target = {
      tab: followView.tab,
      selected: followView.collection ? followView.selected : undefined,
      view: 'collections' as const,
    };
    mobileBack(mobileFollowRoute(target), () => {
      setFollowView(target);
      if (!target.selected) clearCreator();
    });
  };
  const returnFromFollow = (target: FollowView, fallback: () => void) => {
    if (creatorFromSearch && !target.selected) {
      if (desktop) setSearchOpen(true);
      else
        mobileBack('search', () => {
          setSearchOpen(true);
          setPage('search');
        });
    } else if (desktop) fallback();
    else mobileBack(mobileFollowRoute(target), fallback);
  };
  const returnFromPlaying = () => {
    if (!desktop && pagesSuspended) {
      history.back();
      return;
    }
    const restore = () => {
      navigate(listeningReturnPage, true);
      if (!desktop) requestAnimationFrame(() => window.scrollTo(0, listeningReturnScroll.current));
    };
    if (desktop) restore();
    else mobileBack(listeningReturnPage, restore);
  };
  const returnFromSearch = () => {
    if (desktop) closeSearch();
    else mobileBack((route) => route !== 'search', closeSearch);
  };
  const openDesktopSettings = useRef(() => {});
  openDesktopSettings.current = () => {
    setDesktopSettingsRequest((value) => value + 1);
    setDesktopLyrics(false);
    closePopup();
    setSearchOpen(false);
    openSettings();
  };
  useEffect(() => window.slowTuneDesktop?.onOpenLyricsSettings(() => openDesktopSettings.current()), []);
  const toggleListeningPanel = (panel: 'queue' | 'comments') => {
    setVersionsOpen(false);
    const switching = listeningPanel !== panel;
    setListeningPanel(panel);
    setQueueOpen((value) => switching || !value);
  };
  const toggleQueue = () => {
    if (page === 'playing') {
      toggleListeningPanel('queue');
      return;
    }
    setQueueOpen((value) => !value);
  };

  const enterPlaying = () => {
    if (page !== 'playing') {
      setListeningReturnPage(
        desktop ? (page === 'library' ? mobilePlaylistRoute(selected) : page) : mobileRoute,
      );
      listeningReturnScroll.current = window.scrollY;
    }
    if (!desktop) setSearchOpen(false);
    setListeningPanel('queue');
    setPage('playing');
    if (desktop) window.scrollTo(0, 0);
  };
  function revealSearch() {
    if (!desktop) {
      setQueueOpen(false);
      if (page !== 'search') searchOrigin.current = mobileRoute;
      setPage('search');
    }
    setSearchOpen(true);
  }
  const mobileSecondary =
    !desktop &&
    (mobilePageOpen ||
      page === 'settings' ||
      page === 'search' ||
      page === 'playlist' ||
      (page === 'follows' && !!followView.selected));
  return {
    page,
    selected,
    setSelected,
    previousPage,
    followView,
    setFollowView,
    creatorFromSearch,
    setCreatorFromSearch,
    mobilePageOpen,
    pagesSuspended,
    mobileSecondary,
    mobileSection,
    setMobileSection,
    mobileSettingsOpened,
    playlistPage,
    desktopSettingsRequest,
    openSettings,
    openMobileSettings,
    returnFromMobileSettings,
    returnFromMobileFollow,
    returnFromFollow,
    navigate,
    mobileBack,
    returnFromPlaying,
    returnFromSearch,
    enterPlaying,
    revealSearch,
    searchOrigin,
    listeningReturnPage,
    listeningPanel,
    setListeningPanel,
    queueVisible,
    compactQueue,
    closeQueue,
    toggleQueue,
    listFilter,
    setListFilter,
    mobileSongId,
    setMobileSongId,
    setVersionsOpen,
    versionsVisible,
    desktopLyricsOpen,
    closeDesktopLyrics,
    toggleDesktopLyrics,
  };
}
