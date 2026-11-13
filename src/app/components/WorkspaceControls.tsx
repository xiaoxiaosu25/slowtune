import { Button, IconButton } from '../../ui/Button';
import { GearIcon, LinkIcon, ChatCircleTextIcon, QueueIcon } from '@phosphor-icons/react';
import { errorText } from '../../api';
import { isTrack } from '../../chart-playback';
import { CommentsPanel } from '../../CommentsPanel';
import { PlaybackQueue } from '../../PlaybackQueue';
import { RefreshButton } from '../../ListActions';
import { ThemeToggle } from '../../ThemeControls';
import { Cover, artworkKey, displayTitle, names } from '../shared';
import { useWorkspace } from '../workspace-context';
import { useSourceActions } from './TrackList';

export function WorkspaceQueue() {
  const {
    desktop,
    playback,
    flash,
    open,
    snapshot,
    youtubeEnabled,
    youtubeDisplay,
    closeQueue,
    sourceBlocked,
    startPlayback,
    navigate,
    openCreator,
    authorBusy,
    importTracks,
  } = useWorkspace();
  const sourceActions = useSourceActions();
  return (
    <PlaybackQueue
      desktop={desktop}
      onMoveLast={playback.moveLast}
      onMoveNext={(id) => {
        playback.moveNext(id);
        flash('已移到下一首');
      }}
      trackActions={(track) =>
        sourceActions(track, undefined, () => open({ type: 'track', track, entryContext: 'part' }))
      }
      items={snapshot.items}
      youtubeEnabled={youtubeEnabled}
      disabledDisplay={youtubeDisplay}
      currentId={snapshot.currentId}
      playing={snapshot.playing}
      order={snapshot.order}
      shuffleGroups={snapshot.shuffleGroups}
      onShuffleGroups={playback.setShuffleGroups}
      onRemoveGroup={(id)=>void playback.removeGroup(id)}
      renderCover={(track) => <Cover track={track} />}
      title={displayTitle}
      onClose={closeQueue}
      onPlayAll={() => {
        const first = snapshot.items.find((t) => !sourceBlocked(t));
        if (first) void startPlayback(() => playback.select(first.resourceId), false);
      }}
      onSelect={(id) => void startPlayback(() => playback.select(id), false)}
      onMove={playback.move}
      onRemove={(id) => void playback.remove(id)}
      onClear={() => void playback.clear()}
      onSearch={() => navigate('search')}
      onCreator={(track) => void openCreator(track)}
      authorBusy={authorBusy}
      onImport={() =>
        importTracks(
          snapshot.items.filter(isTrack).filter((t) => !sourceBlocked(t)),
          '当前播放队列',
          'part',
          snapshot.items.filter((t) => !isTrack(t) || sourceBlocked(t)).length,
        )
      }
    />
  );
}
export function ListeningSidePanel() {
  const { listeningPanel, setListeningPanel, current, sourceBlocked, closeQueue } = useWorkspace();
  return (
    <div className="listening-sidepanel">
      <div className="listening-panel-tabs segmented" aria-label="聆听面板">
        <Button variant="plain"
          className={listeningPanel === 'comments' ? 'selected' : ''}
          aria-pressed={listeningPanel === 'comments'}
          onClick={() => setListeningPanel('comments')}
        >
          <ChatCircleTextIcon size={18} />
          评论
        </Button>
        <Button variant="plain"
          className={listeningPanel === 'queue' ? 'selected' : ''}
          aria-pressed={listeningPanel === 'queue'}
          onClick={() => setListeningPanel('queue')}
        >
          <QueueIcon size={18} />
          队列
        </Button>
      </div>
      {listeningPanel === 'comments' ? (
        <CommentsPanel
          key={current ? artworkKey(current) : 'empty'}
          track={current && !sourceBlocked(current) ? current : null}
          onClose={closeQueue}
        />
      ) : (
        <WorkspaceQueue />
      )}
    </div>
  );
}

export function GlobalTools({ className }: { className: string }) {
  const { desktopLyricsOpen, open, page, openSettings } = useWorkspace();
  return (
    <div className={className} role="group" aria-label="工具" inert={desktopLyricsOpen}>
      <IconButton

        aria-label="粘贴链接"
        title="粘贴视频或歌单链接"
        onClick={() => open({ type: 'link' })}
      >
        <LinkIcon size={22} />
      </IconButton>
      <ThemeToggle />
      <IconButton
        className={' ' + (page === 'settings' ? ' active' : '')}
        aria-label="设置"
        title="设置"
        aria-current={page === 'settings' ? 'page' : undefined}
        onClick={openSettings}
      >
        <GearIcon size={22} />
      </IconButton>
    </div>
  );
}

export function ErrorFeedback({ error: e, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="feedback" data-tone="error" role="alert">
      <p>
        {errorText(e)}
        {(e as { retained?: boolean })?.retained ? ' 已保留上次内容。' : ''}
      </p>
      <RefreshButton label="重试" onClick={retry} />
    </div>
  );
}

export function SourceTabs() {
  const { youtubeEnabled, source, setSource } = useWorkspace();
  return youtubeEnabled ? (
    <div className="segmented source-tabs" aria-label="音乐来源">
      {Object.entries(names).map(([id, name]) => (
        <Button variant="plain"
          key={id}
          className={source === id ? 'selected' : ''}
          aria-pressed={source === id}
          onClick={() => setSource(id as keyof typeof names)}
        >
          {name}
        </Button>
      ))}
    </div>
  ) : null;
}
