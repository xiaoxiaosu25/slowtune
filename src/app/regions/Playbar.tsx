import {
  PlaybackSlot,
  Transport,
  PlaybackProgress,
  Volume,
  PlaybackRate,
  SleepButton,
  PlaybackMode,
} from '../components/PlaybackControls';
import { PlayerOptions } from '../components/PlayerOptions';
import { SpinnerGapIcon, HeartIcon, QueueIcon } from '@phosphor-icons/react';
import { creator } from '../../api';
import { Cover, displayTitle, useArtworkUrl } from '../shared';
import { CoverGlow } from '../components/CoverGlow';
import { useWorkspace } from '../workspace-context';

/** 桌面底部播放栏。 */
export function Playbar() {
  const { desktop, page, open, current, isFavorite, favoritePending, saving, lib, favorite, queueVisible, snapshot } =
    useWorkspace();
  const artwork = useArtworkUrl(current);
  return (
    <>
      {desktop && page !== 'playing' && (
        <footer className="playbar" aria-label="播放器">
          <CoverGlow artwork={artwork} playing={snapshot.playing} />
          <div className="playbar-inner">
            <div className="playbar-now">
              <button
                className="now-playing"
                aria-label="打开正在播放"
                onClick={() => open({ type: 'playing' })}
              >
                <Cover track={current} />
                <span>
                  <strong title={current?.title}>{current ? displayTitle(current) : '选择一首音乐'}</strong>
                  <small>{current ? creator(current) : '好音乐，等你发现'}</small>
                </span>
              </button>
              <PlaybackSlot />
              {current && (
                <button
                  className={'btn btn-icon playbar-heart ' + (isFavorite(current) ? 'saved' : '')}
                  title={isFavorite(current) ? '取消收藏当前歌曲' : '收藏当前歌曲'}
                  aria-label="收藏当前歌曲"
                  aria-pressed={isFavorite(current)}
                  aria-busy={favoritePending(current) || undefined}
                  disabled={saving || !lib || favoritePending(current)}
                  onClick={() => favorite(current, true, 'part')}
                >
                  {favoritePending(current) ? (
                    <SpinnerGapIcon size={22} className="favorite-spinner" />
                  ) : (
                    <HeartIcon size={22} weight={isFavorite(current) ? 'fill' : 'regular'} />
                  )}
                </button>
              )}
            </div>
            <div className="playbar-center">
              <div className="playbar-controls">
                <PlaybackMode />
                <Transport />
                <span className="transport-balance" aria-hidden="true" />
              </div>
              <PlaybackProgress />
            </div>
            <div className="playbar-tools">
              <Volume />
              <PlaybackRate />
              <SleepButton />
              <button
                className={'btn btn-icon ' + (queueVisible ? 'saved' : '')}
                title="播放队列"
                aria-label="打开播放队列"
                aria-expanded={queueVisible}
                onClick={() => open({ type: 'queue' })}
              >
                <QueueIcon size={25} />
              </button>
              <PlayerOptions dock />
            </div>
          </div>
        </footer>
      )}
    </>
  );
}
