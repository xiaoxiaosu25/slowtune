import { SourceTabs } from '../components/WorkspaceControls';
import { MobileDiscoveryNavigation, MobileProfile } from '../../MobileChrome';
import { MobileSettings } from '../../MobileSettings';
import { mobileSettingsSection } from '../../mobile-settings';
import { SettingsPage } from '../../SettingsPage';
import { DesktopRegion } from '../../DesktopRegion';
import { DiscoverPage, ChartsView, FollowsView, LibraryViews } from './BrowsePages';
import { MobilePlayerView, ListeningStage } from './NowPlaying';
import { useWorkspace } from '../workspace-context';

/** 主内容区：按当前页面显示浏览、歌单、正在播放与设置。 */
export function MainContent() {
  const { desktop, page, desktopLyricsOpen, mobilePageOpen } = useWorkspace();
  return (
    <>
      <main
        className="main-content"
        hidden={!desktop && page === 'search'}
        inert={desktopLyricsOpen || (!desktop && mobilePageOpen)}
      >
        <DesktopRegion enabled={desktop} resetKey={page} label="当前页面">
          <BrowseHeader />
          <MobileBanners />
          <DiscoverPage />
          <ChartsView />
          <FollowsView />
          <LibraryViews />
          <MobilePlayerView />
          <ListeningStage />
          <SettingsViews />
        </DesktopRegion>
      </main>
    </>
  );
}

/** 浏览页标题：移动发现切换、页面标题与来源切换、移动「我的」页。 */
export function BrowseHeader() {
  const {
    desktop,
    page,
    followView,
    navigate,
    youtubeEnabled,
    activeCreator,
    bilibiliAccount,
    openMobileSettings,
  } = useWorkspace();
  return (
    <>
      {!desktop &&
        ['discover', 'charts', 'follows'].includes(page) &&
        !(page === 'follows' && followView.selected) && (
          <MobileDiscoveryNavigation page={page} onNavigate={navigate} />
        )}
      {['discover', 'charts', 'follows'].includes(page) &&
        (desktop ||
          (page !== 'charts' && youtubeEnabled && !(page === 'follows' && followView.selected))) && (
          <div className={'page-heading' + (!desktop ? ' mobile-discovery-heading' : '')}>
            <h1>
              {page === 'discover'
                ? '发现音乐'
                : page === 'charts'
                  ? '音乐榜单'
                  : activeCreator
                    ? '作者内容'
                    : '我的关注'}
            </h1>
            {page !== 'charts' && <SourceTabs />}
          </div>
        )}
      {!desktop && page === 'profile' && (
        <MobileProfile account={bilibiliAccount} onSettings={openMobileSettings} />
      )}
    </>
  );
}

/** 移动端状态提示：断网、读取作者、错误、播放准备、读取歌曲与榜单播放失败。 */
export function MobileBanners() {
  const {
    desktop,
    online,
    authorBusy,
    popup,
    authorWork,
    setAuthorBusy,
    error,
    searchOpen,
    reload,
    pending,
    saving,
    retryWrite,
    setError,
    playback,
    onLogout,
    pagesSuspended,
    snapshot,
    page,
    searchForTitle,
    actionBusy,
    actionWork,
    setActionBusy,
  } = useWorkspace();
  return (
    <>
      {!desktop && !online && (
        <div className="feedback" data-tone="info" role="alert">
          网络已断开。资料保留，联网后可重试。
        </div>
      )}
      {!desktop && authorBusy && !popup && (
        <div className="feedback" role="status">
          <p>正在读取 UP / 博主信息…</p>
          <button
            className="btn btn-ghost"
            onClick={() => {
              authorWork.current?.abort();
              setAuthorBusy(false);
            }}
          >
            取消
          </button>
        </div>
      )}
      {!desktop && error && !popup && !searchOpen && (
        <div className="feedback" data-tone="error" role="alert">
          <p>{error}</p>
          <div className="toolbar">
            <button className="btn btn-ghost" onClick={() => void reload()}>
              重读资料 / 检查服务
            </button>
            {pending && (
              <button className="btn btn-ghost" disabled={saving} onClick={retryWrite}>
                重试保留编辑
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => setError('')}>
              关闭提示
            </button>
            {error.includes('会话') && (
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  await playback.release();
                  onLogout();
                }}
              >
                重新连接
              </button>
            )}
          </div>
        </div>
      )}
      {!desktop &&
        (!popup || pagesSuspended) &&
        !searchOpen &&
        (playback.error || ((playback.preparing || snapshot.loading) && page !== 'playing')) && (
          <div className="feedback" role="status">
            <p>{playback.error || '正在取得真实音轨…'}</p>
            <div className="toolbar">
              {playback.error &&
                (playback.chartSearchTitle ? (
                  <button
                    className="btn btn-ghost"
                    onClick={() => searchForTitle(playback.chartSearchSong ?? playback.chartSearchTitle)}
                  >
                    去搜索
                  </button>
                ) : (
                  <button className="btn btn-ghost" onClick={() => void playback.retry()}>
                    重试播放
                  </button>
                ))}
              <button className="btn btn-ghost" onClick={playback.cancel}>
                取消并停止
              </button>
              {playback.error && (
                <button className="btn btn-ghost" onClick={playback.dismiss}>
                  关闭提示
                </button>
              )}
            </div>
          </div>
        )}
      {!desktop && actionBusy && !popup && !playback.preparing && !snapshot.loading && (
        <div className="feedback" role="status">
          <p>正在读取歌曲信息…</p>
          <button
            className="btn btn-ghost"
            onClick={() => {
              actionWork.current?.abort();
              setActionBusy(false);
            }}
          >
            取消读取
          </button>
        </div>
      )}
      {!desktop && !!playback.chartFailures.length && (
        <div className="feedback chart-playback-failures" role="status">
          <details>
            <summary>{playback.chartFailures.length} 首榜单歌曲未能播放</summary>
            <ul>
              {playback.chartFailures.map((item, index) => (
                <li key={item.id + ':' + index}>
                  {item.title} · {item.reason}
                </li>
              ))}
            </ul>
          </details>
          <button className="btn btn-ghost" onClick={playback.dismissChartFailures}>
            关闭提示
          </button>
        </div>
      )}
    </>
  );
}

/** 设置页：桌面设置与移动设置。 */
export function SettingsViews() {
  const {
    desktop,
    page,
    settingsProps,
    desktopSettingsRequest,
    setMobileSection,
    navigate,
    previousPage,
    mobileSettingsOpened,
    mobileSection,
    openMobileSettings,
  } = useWorkspace();
  return (
    <>
      {desktop && page === 'settings' && (
        <SettingsPage
          {...settingsProps}
          desktopLyricsRequest={desktopSettingsRequest}
          onSectionChanged={(id) => {
            const section = mobileSettingsSection('settings/' + id);
            if (section) setMobileSection(section);
          }}
          onBack={() => navigate(previousPage)}
        />
      )}
      {mobileSettingsOpened && (
        <MobileSettings
          {...settingsProps}
          active={!desktop && page === 'settings'}
          section={mobileSection}
          onSection={openMobileSettings}
        />
      )}
    </>
  );
}
