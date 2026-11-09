import { SourceTabs, ErrorFeedback } from '../components/WorkspaceControls';
import { renderTrackCovers, renderTrackList } from '../components/TrackList';
import { SongLibraryWorkspace } from '../../SongLibraryPage';
import { MobileLibrary } from '../../MobileLibrary';
import { mobilePlaylistRoute } from '../../mobile-library';
import { DiscoveryShelf } from '../../DiscoveryShelf';
import { YoutubeDiscovery } from '../../YoutubeDiscovery';
import { FollowsPage } from '../../FollowsPage';
import { ChartsPage } from '../../ChartsPage';
import { FollowUpdatesShelf } from '../../FollowUpdatesShelf';
import { useWorkspace } from '../workspace-context';

/** 发现页：B站推荐、YouTube 推荐与关注更新。 */
export function DiscoverPage() {
  const {
    page,
    source,
    desktop,
    bilibiliAccount,
    discoverBusy,
    cancelDiscovery,
    discoverError,
    discover,
    discoveryShelves,
    popup,
    searchOpen,
    startPlayback,
    playback,
    importTracks,
    discoveryUpdatedAt,
    discoveryMessage,
    youtubeEnabled,
    youtubeAvailable,
    youtubeRefresh,
    followState,
    navigate,
  } = useWorkspace();
  return (
    <>
      {page === 'discover' && (
        <>
          {source !== 'youtube' && (
            <>
              {!desktop && (
                <>
                  {bilibiliAccount?.state === 'expired' && (
                    <p className="feedback" role="status">
                      B站登录已过期，可在设置中重新登录。
                    </p>
                  )}
                  {discoverBusy && (
                    <div className="loading">
                      正在获取 B站推荐…{' '}
                      <button className="btn btn-ghost" onClick={cancelDiscovery}>
                        取消
                      </button>
                    </div>
                  )}
                  {!!discoverError && (
                    <ErrorFeedback error={discoverError} retry={() => void discover(true)} />
                  )}
                </>
              )}
              {discoveryShelves.map((s) => (
                <DiscoveryShelf
                  mobile={!desktop}
                  key={s.id}
                  shelf={s}
                  displayActive={!popup && !searchOpen}
                  loading={discoverBusy}
                  issue={
                    discoverError ??
                    (bilibiliAccount?.state === 'expired' ? { code: 'bilibili-authentication' } : undefined)
                  }
                  onCancel={cancelDiscovery}
                  renderCovers={renderTrackCovers}
                  renderList={renderTrackList}
                  renderError={(e) => <ErrorFeedback error={e} retry={() => void discover(true)} />}
                  onRefresh={() => void discover(true)}
                  onPlayAll={(items) => void startPlayback(() => playback.playAll(items), false)}
                  onImport={(items, title) => importTracks(items, title)}
                  info={
                    <p>
                      {s.id === 'account-recommendation'
                        ? '从你的B站首页推荐中筛选音乐，每次换一批会重新获取。'
                        : 'B站音乐分区内容，每次换一批会获取其他推荐。'}
                    </p>
                  }
                  status={
                    discoveryUpdatedAt ? (
                      <span>
                        {discoveryMessage} · 获取于{' '}
                        {new Date(discoveryUpdatedAt).toLocaleTimeString('zh-CN')}
                      </span>
                    ) : undefined
                  }
                />
              ))}
            </>
          )}
          {youtubeEnabled && source !== 'bilibili' && (
            <YoutubeDiscovery
              mobile={!desktop}
              displayActive={!popup && !searchOpen}
              available={youtubeAvailable}
              refreshToken={youtubeRefresh}
              renderCovers={renderTrackCovers}
              renderList={renderTrackList}
              onPlayAll={(items) => void startPlayback(() => playback.playAll(items), false)}
              onImport={(items, title) => importTracks(items, title)}
            />
          )}
          <FollowUpdatesShelf
            mobile={!desktop}
            youtubeEnabled={youtubeEnabled}
            state={followState}
            source={source}
            renderCovers={renderTrackCovers}
            renderList={(items) => renderTrackList(items, true)}
            onPlayAll={(items) => void startPlayback(() => playback.playAll(items), false)}
            onImport={(items, title) => importTracks(items, title)}
            onFollow={() => navigate('follows')}
          />
        </>
      )}
    </>
  );
}

/** 音乐榜单页。 */
export function ChartsView() {
  const {
    page,
    desktop,
    playback,
    flash,
    searchForTitle,
    startPlayback,
    toggleChartFavorite,
    mutate,
    libraryIndex,
    saving,
    pending,
    chartFavoriteAction,
    lib,
  } = useWorkspace();
  return (
    <>
      {page === 'charts' && (
        <ChartsPage
          mobile={!desktop}
          onEnqueue={(item, context, next) => {
            void playback.enqueueSelection({ kind: 'chart', context }, item, next).then((ok) => {
              if (ok) flash(next ? '已安排下一首播放' : '已加入队尾');
            });
          }}
          onSearch={(item, context) => searchForTitle({ ...item, ...(context ? { context } : {}) })}
          onPlay={(item, context) =>
            void startPlayback(() =>
              playback.playSelection(
                context
                  ? { kind: 'chart', context }
                  : { kind: 'query', query: { title: item.title, artists: item.artists } },
                item,
              ),
            )
          }
          onPlayAll={(items, contexts) =>
            void startPlayback(
              () =>
                playback.playSelections(
                  items.map((item, index) => ({
                    selection: contexts?.[index]
                      ? { kind: 'chart' as const, context: contexts[index] }
                      : { kind: 'query' as const, query: { title: item.title, artists: item.artists } },
                    song: item,
                  })),
                ),
              false,
            )
          }
          onFavorite={(context) =>
            desktop ? void toggleChartFavorite(context) : void mutate({ context }, false)
          }
          favoriteState={
            desktop
              ? {
                  saved: libraryIndex.chartFavoriteKeys,
                  busy:
                    saving && pending === chartFavoriteAction?.body ? chartFavoriteAction?.key : undefined,
                  disabled: saving || !lib,
                }
              : undefined
          }
        />
      )}
    </>
  );
}

/** 关注页：作者、合集与投稿。 */
export function FollowsView() {
  const {
    page,
    creatorFromSearch,
    desktop,
    followView,
    setFollowView,
    returnFromFollow,
    youtubeEnabled,
    setListImport,
    client,
    followState,
    setFollowState,
    source,
    startPlayback,
    playback,
    importTracks,
    navigate,
    activeCreator,
    setActiveCreator,
  } = useWorkspace();
  return (
    <>
      {page === 'follows' && (
        <FollowsPage
          returnLabel={creatorFromSearch ? '返回用户搜索' : '返回关注'}
          mobile={!desktop}
          navigationView={followView}
          onNavigationViewChange={setFollowView}
          onMobileBack={creatorFromSearch || !desktop ? returnFromFollow : undefined}
          youtubeEnabled={youtubeEnabled}
          onImportSource={setListImport}
          client={client}
          state={followState}
          onChange={setFollowState}
          source={source}
          renderList={(items, timestamps, offset, all) =>
            renderTrackList(items, timestamps, undefined, offset, all)
          }
          renderCovers={(items, timestamps, offset, all) =>
            renderTrackCovers(items, timestamps, items.length, all)
          }
          onPlayAll={(items) => void startPlayback(() => playback.playAll(items), false)}
          onImport={(items, title) => importTracks(items, title)}
          onSearch={() => navigate('search')}
          initialCreator={activeCreator}
          onClearCreator={() => setActiveCreator(undefined)}
        />
      )}
    </>
  );
}

/** 歌单：移动歌单列表与歌单工作区。 */
export function LibraryViews() {
  const {
    desktop,
    page,
    pagesSuspended,
    listeningReturnPage,
    playlistPage,
    currentSong,
    snapshot,
    lib,
    libraryError,
    readLibrary,
    navigate,
    open,
    updateLibrary,
    playback,
    flash,
    enqueueSongs,
    openCreator,
    mobileVersionPlayback,
    youtubeEnabled,
    sources,
    source,
    selected,
    setSelected,
    saving,
    mutate,
    searchForLibrarySong,
    startPlayback,
  } = useWorkspace();
  return (
    <>
      {!desktop &&
        (page === 'library' ||
          (page === 'playing' && pagesSuspended && listeningReturnPage === 'library')) &&
        !playlistPage && (
          <MobileLibrary
            active={page === 'library'}
            library={lib}
            error={libraryError}
            onRetry={() => void readLibrary()}
            onSelect={(id) => navigate(mobilePlaylistRoute(id))}
            onCreate={() => open({ type: 'new' })}
            onBackup={() => open({ type: 'backup' })}
            onChange={updateLibrary}
          />
        )}
      {playlistPage && (
        <SongLibraryWorkspace
          playingSongId={snapshot.playing ? currentSong?.id : undefined}
          hidden={!desktop && page === 'playing'}
          onEnqueue={async (selection, song) => {
            const ok = await playback.enqueueSelection(selection, song);
            if (ok && desktop) flash('已加入队尾');
            return ok;
          }}
          onEnqueueNext={async (selection, song) => {
            const ok = await playback.enqueueSelection(selection, song, true);
            if (ok) flash('已安排下一首播放');
            return ok;
          }}
          onEnqueueAll={enqueueSongs}
          onNotice={flash}
          onCreator={(song, version) =>
            void openCreator({
              ref: version.ref,
              resourceId: version.id,
              title: version.facts.title || song.title,
              url: version.facts.url ?? '',
              uploader: version.facts.uploader
                ? { name: version.facts.uploader, id: version.facts.uploaderId }
                : undefined,
            })
          }
          versionPlayback={desktop ? undefined : mobileVersionPlayback}
          desktop={desktop}
          sourceControls={youtubeEnabled ? <SourceTabs /> : null}
          youtubeEnabled={youtubeEnabled}
          disabledDisplay={sources?.youtube.disabledDisplay ?? 'dim'}
          source={source}
          onChange={updateLibrary}
          state={lib}
          loadError={libraryError}
          onRetry={() => void readLibrary()}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            if (!desktop) navigate(mobilePlaylistRoute(id));
          }}
          busy={saving}
          commit={(edits, revision, localFeedback) =>
            mutate({ edits, ...(revision !== undefined ? { revision } : {}) }, false, localFeedback)
          }
          onBackup={() => open({ type: 'backup' })}
          onSearch={searchForLibrarySong}
          onPlay={(selection, song) => void startPlayback(() => playback.playSelection(selection, song))}
          onPlayAll={(items) => void startPlayback(() => playback.playSelections(items), false)}
        />
      )}
    </>
  );
}
