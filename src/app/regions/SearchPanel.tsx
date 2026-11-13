import { Button } from '../../ui/Button';
import { renderTrackList } from '../components/TrackList';
import { TrackListSkeleton } from '../components/TrackRowCue';
import { ErrorFeedback } from '../components/WorkspaceControls';
import { PlaybackSlot, Transport } from '../components/PlaybackControls';
import { ArrowLeftIcon, MagnifyingGlassIcon, MusicNotesIcon } from '@phosphor-icons/react';
import { errorText } from '../../api';
import { SearchSurface } from '../../SearchSurface';
import { CreatorSearchResults } from '../../CreatorSearch';
import { PlayAllButton, AddToPlaylistButton } from '../../ListActions';
import { PagedList } from '../../Pagination';
import { searchFilterReasons } from '../../../server/search-policy';
import { names, displayTitle } from '../shared';
import { useWorkspace } from '../workspace-context';

/** 搜索面板：视频与用户搜索、来源与排序、结果列表。 */
export function SearchPanel() {
  const {
    searchOpen,
    desktop,
    searched,
    searchReturn,
    query,
    setQuery,
    submitSearch,
    returnFromSearch,
    open,
    closeSearch,
    searchType,
    linkRef,
    searchTarget,
    changeSearchType,
    youtubeEnabled,
    searchSource,
    status,
    setSearchSource,
    searchFor,
    searchSong,
    searchOrder,
    changeSearchOrder,
    creatorOrder,
    setCreatorOrder,
    creatorSearch,
    lib,
    followState,
    setFollowState,
    openSearchCreator,
    pinnedSearch,
    sourceBlocked,
    trackAction,
    results,
    showAllSearch,
    startPlayback,
    playback,
    setListImport,
    importTracks,
    search,
    setResults,
    setShowAllSearch,
    find,
    serial,
    loadMore,
    error,
    popup,
    pending,
    retryWrite,
    setError,
    notice,
    noticeAction,
    current,
    preparingPlayback,
    playAction,
    playbackLabel,
  } = useWorkspace();
  return (
    <>
      {searchOpen && (
        <SearchSurface
          desktop={desktop}
          autoFocus={!searched}
          title={desktop && searchReturn.current ? '添加播放版本' : '搜索音乐'}
          query={query}
          onQuery={setQuery}
          onSearch={submitSearch}
          onClose={returnFromSearch}
          onLink={() => open({ type: 'link' })}
        >
          {desktop && searchReturn.current && (
            <Button variant="ghost" compact  onClick={closeSearch}>
              <ArrowLeftIcon size={18} />
              返回歌曲与版本
            </Button>
          )}
          {desktop && (
            <form
              className="search-field search-dialog-input"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch();
              }}
            >
              <MagnifyingGlassIcon size={21} />
              <input
                aria-label="弹窗搜索关键词"
                placeholder={searchType === 'users' ? '搜索 B站用户昵称' : '搜索歌曲或视频'}
                data-autofocus="true"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button variant="plain" aria-label="搜索" type="submit">
                <MagnifyingGlassIcon size={20} />
              </Button>
            </form>
          )}
          {!linkRef && !searchTarget.current.songId && (
            <div className="segmented search-type-tabs" aria-label="搜索类型">
              <Button variant="plain"
                aria-pressed={searchType === 'video'}
                className={searchType === 'video' ? 'selected' : ''}
                onClick={() => changeSearchType('video')}
              >
                视频
              </Button>
              <Button variant="plain"
                aria-pressed={searchType === 'users'}
                className={searchType === 'users' ? 'selected' : ''}
                onClick={() => changeSearchType('users')}
              >
                用户
              </Button>
            </div>
          )}
          {searchType === 'video' && youtubeEnabled && (
            <div className="segmented search-source-tabs" aria-label="搜索来源">
              {Object.entries(names).map(([id, name]) => (
                <Button variant="plain"
                  key={id}
                  className={searchSource === id ? 'selected' : ''}
                  aria-pressed={searchSource === id}
                  disabled={
                    (id === 'youtube' && !status?.providers.youtube.available) ||
                    (!!linkRef && id !== linkRef.provider)
                  }
                  onClick={() => {
                    setSearchSource(id as keyof typeof names);
                    if (searched && !linkRef)
                      void searchFor(searched, id as keyof typeof names, searchSong, true);
                  }}
                >
                  {name}
                </Button>
              ))}
            </div>
          )}
          {searchType === 'video' && !linkRef && searchSource !== 'youtube' && (
            <div className="search-sort-row">
              <span>B站排序</span>
              <div className="segmented search-sort-tabs" aria-label="B站搜索排序">
                {(
                  [
                    ['relevance', '综合排序'],
                    ['plays', '最多播放'],
                    ['favorites', '最多收藏'],
                    ['newest', '最新发布'],
                  ] as const
                ).map(([order, label]) => (
                  <Button variant="plain"
                    key={order}
                    className={searchOrder === order ? 'selected' : ''}
                    aria-pressed={searchOrder === order}
                    onClick={() => changeSearchOrder(order)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {searchType === 'users' && (
            <label className="creator-search-sort">
              <span>用户排序</span>
              <select
                className="select"
                aria-label="用户搜索排序"
                value={creatorOrder}
                onChange={(event) => {
                  const order = event.target.value as typeof creatorOrder;
                  setCreatorOrder(order);
                  if (searched) void creatorSearch.search(searched, 1, order);
                }}
              >
                <option value="relevance">默认排序</option>
                <option value="followers">粉丝最多</option>
              </select>
            </label>
          )}
          <div className="search-results">
            {searchType === 'video' && !desktop && !searched && !linkRef ? (
              <div className="mobile-search-empty">
                <MusicNotesIcon size={40} />
                <h1>听点喜欢的</h1>
                <p>搜索歌名、歌手，找到想听的版本。</p>
              </div>
            ) : (
              <p className="muted search-description">
                {searchTarget.current.songId
                  ? `为「${lib?.snapshot.songs.find((song) => song.id === searchTarget.current.songId)?.title ?? searched}」添加版本，点击结果右侧的 ＋ 即可。`
                  : linkRef
                    ? '公开视频歌单'
                    : searched
                      ? `“${searched}” 的搜索结果`
                      : searchType === 'users'
                        ? '输入昵称，找到喜欢的作者。'
                        : '输入歌名，找到想听的版本。'}
              </p>
            )}
            {searchType === 'users' ? (
              <CreatorSearchResults
                search={creatorSearch}
                query={searched}
                order={creatorOrder}
                state={followState}
                onChange={setFollowState}
                onOpen={openSearchCreator}
              />
            ) : (
              <>
                {!linkRef &&
                  !searchTarget.current.songId &&
                  pinnedSearch.map((item) => (
                    <section key={item.key} className="search-preferred" aria-label="自动匹配的优先结果">
                      <div>
                        <strong>
                          自动匹配「{item.song.title}
                          {item.song.artists?.length ? ' · ' + item.song.artists.join(' / ') : ''}
                          」时优先选择
                        </strong>
                        <p>{item.entry.title}</p>
                        {sourceBlocked(item.entry) && (
                          <p>YouTube 已关闭，可在设置的偏好中管理这个匹配结果。</p>
                        )}
                      </div>
                      <div className="toolbar">
                        <Button variant="primary" compact

                          disabled={sourceBlocked(item.entry)}
                          onClick={() => void trackAction(item.entry, 'play', undefined, 'part')}
                        >
                          播放此结果
                        </Button>
                        <Button variant="secondary" compact

                          onClick={() =>
                            open({
                              type: 'track',
                              track: item.entry,
                              entryContext: 'part',
                              searchSong: item.song,
                            })
                          }
                        >
                          管理匹配偏好
                        </Button>
                      </div>
                    </section>
                  ))}
                {Object.entries(results)
                  .filter(([p]) => searchSource === 'all' || searchSource === p)
                  .map(([p, r]) => {
                    const filtered =
                      !linkRef && r.config
                        ? r.items.filter((track) => !searchFilterReasons(track, r.config!, searched).length)
                        : r.items;
                    const hidden = r.items.length - filtered.length,
                      showAll = showAllSearch ?? !(r.config?.filterByDefault ?? true),
                      visible = showAll ? r.items : filtered;
                    return (
                      <section className="catalog" key={p}>
                        <div className="section-heading">
                          <h2>{names[p as keyof typeof names]}</h2>
                          <div className="toolbar">
                            <PlayAllButton
                              compact
                              count={visible.length}
                              onClick={() => void startPlayback(() => playback.playAll(visible), false)}
                            />
                            <AddToPlaylistButton
                              compact
                              count={linkRef ? 1 : visible.length}
                              disabled={r.busy}
                              onClick={() =>
                                linkRef
                                  ? setListImport({
                                      title: '公开歌单',
                                      source: { kind: 'playlist', ref: linkRef },
                                    })
                                  : importTracks(visible, '搜索结果 · ' + searched)
                              }
                            />
                            {r.busy && (
                              <Button variant="ghost"

                                onClick={() => {
                                  search.current?.abort();
                                  setResults((old) =>
                                    Object.fromEntries(
                                      Object.entries(old).map(([k, v]) => [k, { ...v, busy: false }]),
                                    ),
                                  );
                                }}
                              >
                                取消搜索
                              </Button>
                            )}
                          </div>
                        </div>
                        {!linkRef && r.config && (
                          <div className="search-filter-notice" role="status">
                            <p>
                              {showAll
                                ? `正在显示全部结果。${hidden ? `其中 ${hidden} 条不符合当前偏好。` : ''}`
                                : `当前已加载 ${r.items.length} 条结果，${hidden} 条被偏好规则筛选。`}
                              <span>
                                保留{p === 'bilibili' ? ' B站所选排序' : '来源顺序'}
                                ；筛选切换仅影响本次展示。
                              </span>
                            </p>
                            <Button variant="secondary" compact

                              onClick={() => setShowAllSearch(!showAll)}
                            >
                              {showAll ? '恢复筛选' : '显示全部'}
                            </Button>
                          </div>
                        )}
                        {r.classificationIssue && (
                          <p className="notice" role="status">
                            部分结果的分区暂时无法确认，可点击“显示全部”手动选择。
                            {errorText(r.classificationIssue)}
                          </p>
                        )}
                        {!!r.error && (
                          <ErrorFeedback
                            error={r.error}
                            retry={() => {
                              const c =
                                search.current && !search.current.signal.aborted
                                  ? search.current
                                  : new AbortController();
                              search.current = c;
                              void find(
                                p as 'youtube' | 'bilibili',
                                searched,
                                c,
                                r.items.length ? r.cursor : undefined,
                                linkRef,
                              );
                            }}
                          />
                        )}
                        <PagedList
                          id={'search:' + serial.current + ':' + p + ':' + showAllSearch}
                          group="search"
                          label={names[p as keyof typeof names] + '搜索结果'}
                          items={visible}
                          busy={r.busy}
                          error={!!r.error}
                          cursor={r.cursor}
                          onLoadMore={() => loadMore(p as 'youtube' | 'bilibili')}
                        >
                          {(items, offset) =>
                            items.length ? (
                              renderTrackList(
                                items,
                                false,
                                linkRef ? undefined : (searchSong ?? { title: searched }),
                                offset,
                                visible,
                              )
                            ) : r.busy ? (
                              <TrackListSkeleton label="正在搜索…" />
                            ) : (
                              !r.error && (
                                <div className="empty">
                                  <h3>{hidden ? '当前偏好筛选了所有已加载结果' : '没有搜索结果'}</h3>
                                  <p>
                                    {hidden
                                      ? '点击“显示全部”查看可能被误筛的结果。'
                                      : '换个关键词或来源试试。'}
                                  </p>
                                </div>
                              )
                            )
                          }
                        </PagedList>
                      </section>
                    );
                  })}
              </>
            )}
            {error && !popup && (
              <div className="feedback" role="alert">
                <p>{error}</p>
                {pending && (
                  <Button variant="secondary"  onClick={retryWrite}>
                    重试保留编辑
                  </Button>
                )}
                <Button variant="ghost"  onClick={() => setError('')}>
                  关闭提示
                </Button>
              </div>
            )}
            {desktop && notice && !popup && !error && (
              <div className="action-notice" role="status">
                {notice}
                {noticeAction && (
                  <Button variant="ghost" compact  onClick={noticeAction.run}>
                    {noticeAction.label}
                  </Button>
                )}
              </div>
            )}
            {!desktop && playback.error && !popup && (
              <p className="feedback" role="alert">
                {playback.error}
              </p>
            )}
          </div>
          {desktop &&
            (current ||
              preparingPlayback ||
              playAction?.error ||
              playback.error ||
              playback.chartFailures.length > 0) && (
              <div className="search-playing">
                <span>
                  {current ? displayTitle(current) : (playAction?.track.title ?? '播放状态')} ·{' '}
                  {playbackLabel}
                </span>
                <PlaybackSlot />
                <Transport />
              </div>
            )}
        </SearchSurface>
      )}
    </>
  );
}
