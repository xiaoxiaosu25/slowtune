import { PlayerOptions } from '../components/PlayerOptions';
import { ArrowLeftIcon, MagnifyingGlassIcon, ArrowRightIcon } from '@phosphor-icons/react';
import { MobileHeader } from '../../MobileChrome';
import { nav } from '../shared';
import { useWorkspace } from '../workspace-context';

/** 顶栏：桌面为导航与搜索框（正在播放时为返回栏），移动端为页面标题栏。 */
export function TopBar() {
  const {
    desktop,
    page,
    desktopLyricsOpen,
    navigate,
    listeningReturnPage,
    snapshot,
    searchFor,
    query,
    setQuery,
    mobilePlaylistTitle,
    mobileSection,
    openSearch,
    open,
    returnFromMobileSettings,
    mobileBack,
    returnFromPlaying,
    followView,
    creatorFromSearch,
    returnFromMobileFollow,
  } = useWorkspace();
  return (
    <>
      {desktop ? (
        <header
          className={'topbar' + (page === 'playing' ? ' listening-header' : '')}
          inert={desktopLyricsOpen}
        >
          {page === 'playing' ? (
            <>
              <button
                className="btn btn-icon"
                aria-label="返回浏览音乐"
                title="返回浏览音乐"
                onClick={() => navigate(listeningReturnPage)}
              >
                <ArrowLeftIcon size={23} />
              </button>
              <div className="listening-header-title">
                <h1>正在播放</h1>
                <span>
                  {snapshot.items.length ? `${snapshot.items.length} 首音乐 · 慢听` : '慢听 · 音乐空间'}
                </span>
              </div>
            </>
          ) : (
            <>
              <button className="brand" onClick={() => navigate('discover')}>
                慢听
              </button>
              <nav className="desktop-nav" aria-label="主导航">
                {nav.map((n) => (
                  <button
                    key={n.id}
                    className={page === n.id ? 'active' : ''}
                    onClick={() => navigate(n.id)}
                  >
                    {n.label}
                  </button>
                ))}
              </nav>
              <form
                className="search-field"
                onSubmit={(e) => {
                  e.preventDefault();
                  void searchFor(query, 'all');
                }}
              >
                <MagnifyingGlassIcon size={21} />
                <input
                  aria-label="搜索歌曲或视频"
                  placeholder="搜索歌曲或视频"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button aria-label="开始搜索" title="开始搜索" type="submit">
                  <ArrowRightIcon size={19} />
                </button>
              </form>
            </>
          )}
        </header>
      ) : (
        page !== 'search' && (
          <MobileHeader
            page={page}
            playlistTitle={mobilePlaylistTitle}
            settingsSection={mobileSection}
            onSearch={openSearch}
            onLink={() => open({ type: 'link' })}
            onBack={
              page === 'settings'
                ? returnFromMobileSettings
                : page === 'playlist'
                  ? () => mobileBack('library', () => navigate('library'))
                  : returnFromPlaying
            }
            options={<PlayerOptions />}
            followDetail={
              page === 'follows' && followView.selected
                ? {
                    title: followView.collection ? '合集' : '作者',
                    backLabel: followView.collection
                      ? '返回作者合集'
                      : creatorFromSearch
                        ? '返回用户搜索'
                        : '返回关注',
                    onBack: returnFromMobileFollow,
                  }
                : undefined
            }
          />
        )
      )}
    </>
  );
}
