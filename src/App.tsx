import type { MusicClient } from '@studio/music-sources/client';
import { EntryGate } from './EntryGate';
import type { StartupPreload } from './startup';
import { ArtworkContext, YoutubeEnabledContext } from './app/shared';
import { useWorkspaceController } from './app/useWorkspaceController';
import { WorkspaceContext } from './app/workspace-context';
import { StaleBuildNotice } from './app/regions/StaleBuildNotice';
import { Sidebar } from './app/regions/Sidebar';
import { TopBar } from './app/regions/TopBar';
import { MainContent } from './app/regions/MainContent';
import { LyricsLayers, PlaybackLayers, WorkspaceDialogs } from './app/regions/Overlays';
import { Playbar } from './app/regions/Playbar';
import { MobileDock } from './app/regions/MobileDock';
import { SearchPanel } from './app/regions/SearchPanel';
import { ActionModal } from './app/regions/ActionModal';

export function App() {
  return (
    <EntryGate>
      {(client, preload, onLogout) => <Workspace client={client} preload={preload} onLogout={onLogout} />}
    </EntryGate>
  );
}

/** 工作区：调用控制器，再按界面区域组装页面。各区域自行决定何时显示。 */
function Workspace(props: { client: MusicClient; preload: StartupPreload; onLogout: () => void }) {
  const ws = useWorkspaceController(props);
  const {
    build,
    reload,
    youtubeEnabled,
    knownArtworks,
    page,
    mobilePlayerEmpty,
    mobileSecondary,
    desktop,
    mobilePageOpen,
    queueVisible,
    desktopLyricsOpen,
    bottomLyricsVisible,
    playerStyle,
  } = ws;
  if (build?.stale) return <StaleBuildNotice build={build} reload={reload} />;
  return (
    <YoutubeEnabledContext.Provider value={youtubeEnabled}>
      <ArtworkContext.Provider value={knownArtworks}>
        <WorkspaceContext.Provider value={ws}>
          <div
            className={
              'app ' +
              (page === 'playing' ? 'immersive ' : '') +
              (mobilePlayerEmpty ? 'mobile-player-empty ' : '') +
              (mobileSecondary ? 'mobile-secondary-open ' : '') +
              (!desktop && mobilePageOpen ? 'mobile-page-open ' : '') +
              (page === 'settings' && !desktop ? 'mobile-settings-open ' : '') +
              (page === 'search' && !desktop ? 'mobile-search-open ' : '') +
              (queueVisible ? 'has-queue ' : '') +
              (desktopLyricsOpen ? 'desktop-lyrics-open ' : '') +
              (bottomLyricsVisible ? 'has-bottom-lyrics ' : '')
            }
            data-layout={desktop ? 'desktop' : 'mobile'}
            data-player-style={playerStyle}
          >
            <Sidebar />
            <TopBar />
            <MainContent />
            <LyricsLayers />
            <PlaybackLayers />
            <Playbar />
            <MobileDock />
            <SearchPanel />
            <ActionModal />
            <WorkspaceDialogs />
          </div>
        </WorkspaceContext.Provider>
      </ArtworkContext.Provider>
    </YoutubeEnabledContext.Provider>
  );
}
