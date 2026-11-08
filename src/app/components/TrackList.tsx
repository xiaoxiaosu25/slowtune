import {
  PlayIcon,
  SkipForwardIcon,
  QueueIcon,
  PlusIcon,
  HeartIcon,
  ListBulletsIcon,
  MusicNotesIcon,
  UsersIcon,
  LinkIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  TrashIcon,
  SpinnerGapIcon,
  DotsThreeIcon,
} from '@phosphor-icons/react';
import { availabilityText, key, time, type Track } from '../../api';
import { MobileBrowseTitle } from '../../MobileBrowseTitle';
import { PartBadge } from '../../PartBadge';
import { updateTime } from '../../FollowsPage';
import { ActionMenu, type MenuAction } from '../../ActionMenu';
import { sourcePageUrl, copySourceLink } from '../../source-page-url';
import type { EntryContext } from '../../multipart';
import { searchFilterReasons, type SongQuery } from '../../../server/search-policy';
import { Badge, Cover, artworkKey, displayTitle, favoritesId } from '../shared';
import { useWorkspace } from '../workspace-context';

export function useSourceActions() {
  const {
    sourceBlocked,
    isFavorite,
    playback,
    flash,
    trackAction,
    saving,
    lib,
    mutate,
    favoritePending,
    favorite,
    open,
    authorBusy,
    openCreator,
  } = useWorkspace();
  return (t: Track, searchContext?: SongQuery, onDetails?: () => void): MenuAction[] => {
    const blocked = sourceBlocked(t),
      saved = isFavorite(t),
      multiple = (t.parts?.length ?? 0) > 1;
    const enqueue = (next: boolean) => {
      void playback.add(t, false, next).then((ok) => {
        if (ok) flash(next ? '已安排下一首播放' : '已加入队尾');
      });
    };
    const actions: MenuAction[] = [
      {
        id: 'play',
        label: multiple ? '立即播放本 P' : '立即播放',
        icon: <PlayIcon size={18} />,
        disabled: blocked,
        hint: blocked ? 'YouTube 已关闭' : undefined,
        onSelect: () => void trackAction(t, 'play', undefined, 'part'),
      },
      {
        id: 'next',
        label: multiple ? '下一首播放本 P' : '下一首播放',
        icon: <SkipForwardIcon size={18} />,
        disabled: blocked,
        hint: blocked ? 'YouTube 已关闭' : undefined,
        onSelect: () => enqueue(true),
      },
      {
        id: 'last',
        label: '加入队尾',
        icon: <QueueIcon size={18} />,
        disabled: blocked,
        onSelect: () => enqueue(false),
      },
      { separator: true },
      t.targetSongId
        ? {
            id: 'version',
            label: '添加为这首歌曲的版本',
            icon: <PlusIcon size={18} />,
            disabled: saving || !lib || blocked,
            onSelect: () =>
              void mutate({ save: { refs: [t.ref], target: 'version', songId: t.targetSongId } }, false),
          }
        : {
            id: 'favorite',
            label: saved ? '取消收藏' : '收藏',
            icon: <HeartIcon size={18} weight={saved ? 'fill' : 'regular'} />,
            disabled: saving || !lib || favoritePending(t) || (blocked && !saved),
            hint: blocked && !saved ? 'YouTube 已关闭' : undefined,
            onSelect: () => favorite(t, true, 'part'),
          },
      {
        id: 'playlist',
        label: '加入歌单…',
        icon: <ListBulletsIcon size={18} />,
        disabled: !lib || blocked,
        onSelect: () =>
          open({
            type: 'track',
            track: t,
            entryContext: 'part',
            intent: 'playlist',
            searchSong: searchContext,
          }),
      },
      {
        id: 'details',
        label: '歌曲详情与分 P…',
        icon: <MusicNotesIcon size={18} />,
        onSelect:
          onDetails ??
          (() => open({ type: 'track', track: t, entryContext: 'video', searchSong: searchContext })),
      },
      { separator: true },
      {
        id: 'creator',
        label: '查看 UP / 博主',
        icon: <UsersIcon size={18} />,
        disabled: authorBusy || blocked,
        onSelect: () => void openCreator(t),
      },
      { id: 'source', label: '打开原视频', icon: <LinkIcon size={18} />, href: sourcePageUrl(t) },
      {
        id: 'copy',
        label: '复制来源链接',
        onSelect: () => {
          void copySourceLink(sourcePageUrl(t))
            .then(() => flash('已复制来源链接'))
            .catch(() => flash('复制失败，请从原视频复制链接'));
        },
      },
    ];
    return actions;
  };
}

function TrackSourceMenu({
  track: t,
  target,
  searchContext,
  onDetails,
}: {
  track: Track;
  target: string;
  searchContext?: SongQuery;
  onDetails?: () => void;
}) {
  const sourceActions = useSourceActions();
  return (
    <ActionMenu
      label={'更多操作 ' + t.title}
      title={displayTitle(t)}
      subtitle={t.ref.provider === 'bilibili' ? 'B站 · 操作本 P' : 'YouTube'}
      target={target}
      actions={sourceActions(t, searchContext, onDetails)}
      className={target === '.music-card' ? 'card-menu' : 'track-menu'}
    />
  );
}

export function CreatorContent({ track, className = '' }: { track: Track; className?: string }) {
  const { desktop, authorBusy, authorTarget, sourceBlocked, openCreator, cancelAuthor } = useWorkspace();
  return (
    <span className={'creator-details ' + className}>
      {track.artists?.length && (desktop || className !== 'card-creator') ? (
        <span className="creator-artists">{track.artists.join(' / ')}</span>
      ) : null}
      <button
        className="creator-link"
        title={'查看 ' + (track.uploader?.name ?? 'UP / 博主') + ' 的合集和投稿'}
        aria-label={'查看 UP / 博主 · ' + track.title}
        aria-busy={(desktop && authorBusy && authorTarget === artworkKey(track)) || undefined}
        disabled={authorBusy || sourceBlocked(track)}
        onClick={() => void openCreator(track)}
      >
        {desktop && authorBusy && authorTarget === artworkKey(track)
          ? '正在读取作者…'
          : !desktop && className === 'card-creator' && track.artists?.length
            ? track.artists.join(' / ')
            : (track.uploader?.name ?? '查看 UP / 博主')}
      </button>
      {desktop && authorBusy && authorTarget === artworkKey(track) && (
        <button className="btn btn-ghost btn-sm" onClick={cancelAuthor}>
          取消
        </button>
      )}
    </span>
  );
}

type TrackRowProps = {
  track: Track;
  context?: 'normal' | 'queue' | 'playlist' | 'favorite' | 'part';
  index?: number;
  list?: Track[];
  timestamps?: boolean;
  searchContext?: SongQuery;
};

export function TrackRow({
  track: t,
  context = 'normal',
  index = 0,
  list,
  timestamps = false,
  searchContext,
}: TrackRowProps) {
  const {
    isFavorite,
    isVideoFavorite,
    startPlayback,
    playback,
    trackAction,
    results,
    searched,
    sourceBlocked,
    youtubeDisplay,
    current,
    desktop,
    browseTitle,
    partsStore,
    popup,
    page,
    searchOpen,
    showParts,
    browseArtist,
    snapshot,
    saving,
    lib,
    mutate,
    favoritePending,
    favorite,
    setPopup,
    open,
    playlist,
  } = useWorkspace();
  const entryContext: EntryContext = context === 'normal' ? 'video' : 'part';
  const saved = entryContext === 'video' ? isVideoFavorite(t) : isFavorite(t);
  const playTrack = () =>
    context === 'queue'
      ? startPlayback(() => playback.select(t.resourceId), false)
      : trackAction(
          t,
          'play',
          list && list.length ? { tracks: list, index: list.indexOf(t) } : undefined,
          context === 'part' ? 'video' : entryContext,
        );
  const filterReasons =
    searchContext && results[t.ref.provider]?.config
      ? searchFilterReasons(t, results[t.ref.provider].config!, searched)
      : [];
  return (
    <div
      className={
        'track-row ' +
        (context === 'favorite' ? 'playlist' : context) +
        ' ' +
        (filterReasons.length ? 'search-filtered-row ' : '') +
        (sourceBlocked(t) ? 'source-closed ' : '') +
        (sourceBlocked(t) && youtubeDisplay === 'dim' ? 'source-disabled ' : '') +
        (current && key(current.ref) === key(t.ref) ? 'current' : '')
      }
    >
      {context !== 'queue' && context !== 'part' && (
        <span className="row-number">
          {String(
            (searchContext
              ? (results[t.ref.provider]?.items.findIndex((item) => item.resourceId === t.resourceId) ??
                index)
              : index) + 1,
          ).padStart(2, '0')}
        </span>
      )}
      <button
        className="row-cover"
        aria-label={'播放 ' + t.title}
        disabled={sourceBlocked(t)}
        onClick={() => void playTrack()}
      >
        <Cover track={t} />
      </button>
      <div className="row-info">
        {!desktop && context === 'normal' ? (
          <MobileBrowseTitle
            className="track-name"
            title={browseTitle(t)}
            originalTitle={t.title}
            disabled={sourceBlocked(t)}
            onPlay={() => void playTrack()}
          />
        ) : (
          <button
            className="track-name"
            title={t.title}
            disabled={sourceBlocked(t)}
            onClick={() => void playTrack()}
          >
            {displayTitle(t)}
          </button>
        )}
        {context !== 'part' && (
          <PartBadge
            track={t}
            store={partsStore}
            active={!popup && !sourceBlocked(t)}
            viewKey={page + ':' + searchOpen}
            onOpen={() => void showParts(t)}
          />
        )}
        <div className="row-sub">
          {!desktop && context === 'normal' ? (
            <span className="mobile-row-artist">{browseArtist(t)}</span>
          ) : (
            <CreatorContent track={t} />
          )}
          <Badge provider={t.ref.provider} />
        </div>
        {timestamps && (
          <time
            className="row-update"
            dateTime={t.publishedAt ? new Date(t.publishedAt).toISOString() : undefined}
          >
            {updateTime(t.publishedAt)}
          </time>
        )}
        {t.unavailable && <span className="row-status error-text">{availabilityText(t.unavailable)}</span>}
        {sourceBlocked(t) && <span className="row-status">YouTube 已关闭</span>}
      </div>
      {context !== 'queue' && context !== 'part' && (
        <>
          <CreatorContent track={t} className="row-creator" />
          <span className="row-source">
            <Badge provider={t.ref.provider} />
          </span>
        </>
      )}
      <span className="row-duration">{time(t.durationSeconds)}</span>
      {context === 'queue' ? (
        <>
          <button
            className="btn btn-icon"
            aria-label={'队列上移 ' + t.title}
            disabled={index === 0}
            onClick={() => playback.move(t.resourceId, index - 1)}
          >
            <ArrowUpIcon size={18} />
          </button>
          <button
            className="btn btn-icon"
            aria-label={'队列下移 ' + t.title}
            disabled={index === snapshot.items.length - 1}
            onClick={() => playback.move(t.resourceId, index + 1)}
          >
            <ArrowDownIcon size={18} />
          </button>
          <button
            className="btn btn-icon"
            aria-label={'移除队列 ' + t.title}
            onClick={() => void playback.remove(t.resourceId)}
          >
            <TrashIcon size={20} />
          </button>
        </>
      ) : (
        <>
          {t.targetSongId ? (
            <button
              className="btn btn-icon"
              title="添加为这首歌曲的版本"
              aria-label={'添加版本 ' + t.title}
              disabled={saving || !lib || sourceBlocked(t)}
              onClick={() =>
                void mutate({ save: { refs: [t.ref], target: 'version', songId: t.targetSongId } }, false)
              }
            >
              <PlusIcon size={21} />
            </button>
          ) : (
            <button
              className={'btn btn-icon ' + (saved ? 'saved' : '')}
              title={saved && entryContext === 'part' ? '取消收藏' : '收藏'}
              aria-label={(saved && entryContext === 'part' ? '取消收藏 ' : '收藏 ') + t.title}
              aria-pressed={saved}
              aria-busy={favoritePending(t) || undefined}
              disabled={saving || !lib || favoritePending(t)}
              onClick={() => favorite(t, true, entryContext)}
            >
              {favoritePending(t) ? (
                <SpinnerGapIcon size={21} className="favorite-spinner" />
              ) : (
                <HeartIcon size={21} weight={saved ? 'fill' : 'regular'} />
              )}
            </button>
          )}
          {desktop ? (
            <TrackSourceMenu
              track={t}
              target=".track-row"
              searchContext={searchContext}
              onDetails={
                context === 'part'
                  ? () =>
                      setPopup((old) =>
                        old
                          ? {
                              ...old,
                              track: t,
                              entryContext: 'part',
                              intent: 'overview',
                              step: (old.step ?? 0) + 1,
                            }
                          : old,
                      )
                  : undefined
              }
            />
          ) : (
            <button
              className="btn btn-icon"
              title="更多操作"
              aria-label={'更多操作 ' + t.title}
              onClick={() =>
                context === 'part'
                  ? setPopup((old) =>
                      old
                        ? {
                            ...old,
                            track: t,
                            entryContext: 'part',
                            intent: 'overview',
                            step: (old.step ?? 0) + 1,
                          }
                        : old,
                    )
                  : open({
                      type: 'track',
                      track: t,
                      entryContext,
                      searchSong: searchContext,
                      id:
                        context === 'favorite'
                          ? favoritesId
                          : context === 'playlist'
                            ? playlist?.id
                            : undefined,
                      origin: list && list.length ? { tracks: list, index: list.indexOf(t) } : undefined,
                    })
              }
            >
              <DotsThreeIcon size={26} />
            </button>
          )}
        </>
      )}
      {!!filterReasons.length && (
        <span className="row-status search-filter-reason">筛选原因：{filterReasons.join('、')}</span>
      )}
    </div>
  );
}

type TrackListProps = {
  items: Track[];
  timestamps?: boolean;
  searchContext?: SongQuery;
  offset?: number;
  all?: Track[];
};
export function TrackList({
  items,
  timestamps = false,
  searchContext,
  offset = 0,
  all = items,
}: TrackListProps) {
  const tableHeading = (
    <div className="track-table-heading">
      <span className="row-number">#</span>
      <span aria-hidden="true" />
      <span>歌曲</span>
      <span>作者</span>
      <span>来源</span>
      <span className="row-duration">时长</span>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
  return items.length ? (
    <div className="track-list">
      {tableHeading}
      {items.map((t, i) => (
        <TrackRow
          key={t.resourceId}
          track={t}
          index={offset + i}
          list={all}
          timestamps={timestamps}
          searchContext={searchContext}
        />
      ))}
    </div>
  ) : (
    <div className="empty">
      <ListBulletsIcon size={38} />
      <h3>这里还没有音乐</h3>
      <p>从搜索或链接添加喜欢的声音。</p>
    </div>
  );
}

function TrackCoverCard({
  track: t,
  all,
  timestamps,
}: {
  track: Track;
  all: Track[];
  timestamps: boolean;
}) {
  const {
    trackAction,
    isVideoFavorite,
    favoritePending,
    saving,
    lib,
    favorite,
    desktop,
    browseTitle,
    partsStore,
    popup,
    page,
    searchOpen,
    showParts,
    open,
  } = useWorkspace();
  return (
    <article className="music-card">
      <div className="art-wrap">
        <button
          className="cover-button"
          aria-label={'播放 ' + t.title}
          onClick={() => void trackAction(t, 'play', { tracks: all, index: all.indexOf(t) }, 'video')}
        >
          <Cover track={t} />
        </button>
        <button
          className={'cover-favorite ' + (isVideoFavorite(t) ? 'saved' : '')}
          aria-label={'收藏 ' + t.title}
          aria-pressed={isVideoFavorite(t)}
          aria-busy={favoritePending(t) || undefined}
          disabled={saving || !lib || favoritePending(t)}
          onClick={() => favorite(t, true, 'video')}
        >
          {favoritePending(t) ? (
            <SpinnerGapIcon size={18} className="favorite-spinner" />
          ) : (
            <HeartIcon size={18} weight={isVideoFavorite(t) ? 'fill' : 'regular'} />
          )}
        </button>
      </div>
      <div className="card-heading">
        {desktop ? (
          <button
            className="card-title"
            title={t.title}
            onClick={() => void trackAction(t, 'play', { tracks: all, index: all.indexOf(t) }, 'video')}
          >
            {displayTitle(t)}
          </button>
        ) : (
          <MobileBrowseTitle
            className="card-title"
            title={browseTitle(t)}
            originalTitle={t.title}
            onPlay={() => void trackAction(t, 'play', { tracks: all, index: all.indexOf(t) }, 'video')}
          />
        )}
        <PartBadge
          track={t}
          store={partsStore}
          active={!popup}
          viewKey={page + ':' + searchOpen}
          onOpen={() => void showParts(t)}
        />
      </div>
      <div className="card-foot">
        <CreatorContent track={t} className="card-creator" />
        <Badge provider={t.ref.provider} />
        {desktop ? (
          <TrackSourceMenu track={t} target=".music-card" />
        ) : (
          <button
            className="btn btn-icon card-menu"
            aria-label={'更多操作 ' + t.title}
            onClick={() =>
              open({
                type: 'track',
                track: t,
                entryContext: 'video',
                origin: { tracks: all, index: all.indexOf(t) },
              })
            }
          >
            <DotsThreeIcon size={22} />
          </button>
        )}
      </div>
      {timestamps && (
        <time
          className="card-update"
          dateTime={t.publishedAt ? new Date(t.publishedAt).toISOString() : undefined}
        >
          {updateTime(t.publishedAt)}
        </time>
      )}
    </article>
  );
}

type TrackCoversProps = { items: Track[]; timestamps?: boolean; slots?: number; all?: Track[] };
export function TrackCovers({
  items,
  timestamps = false,
  slots = items.length,
  all = items,
}: TrackCoversProps) {
  return (
    <div className="cover-grid">
      {items.map((track) => (
        <TrackCoverCard key={track.resourceId} track={track} all={all} timestamps={timestamps} />
      ))}
      {Array.from({ length: Math.max(0, slots - items.length) }, (_, i) => (
        <article className="music-card catalog-empty-slot" key={'empty-' + i} aria-hidden="true">
          <div className="cover-button">
            <span className="unknown-cover">
              <MusicNotesIcon size={28} />
            </span>
          </div>
          <span className="card-title">暂无符合规则的歌曲</span>
        </article>
      ))}
    </div>
  );
}

export function renderTrackList(
  items: Track[],
  timestamps?: boolean,
  searchContext?: SongQuery,
  offset?: number,
  all?: Track[],
) {
  return (
    <TrackList
      items={items}
      timestamps={timestamps}
      searchContext={searchContext}
      offset={offset}
      all={all}
    />
  );
}

export function renderTrackCovers(items: Track[], timestamps?: boolean, slots?: number, all?: Track[]) {
  return <TrackCovers items={items} timestamps={timestamps} slots={slots} all={all} />;
}
