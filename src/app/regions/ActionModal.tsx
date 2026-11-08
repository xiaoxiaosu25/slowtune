import { TrackRow, CreatorContent } from '../components/TrackList';
import { PlaybackSlot } from '../components/PlaybackControls';
import { PlusIcon, UsersIcon, LinkIcon } from '@phosphor-icons/react';
import { availabilityText, time, key } from '../../api';
import { PartsPanel } from '../../PartsPanel';
import { SleepPanel } from '../../SleepPanel';
import { FollowTrackButton } from '../../FollowsPage';
import { Modal } from '../../Modal';
import { Dialog } from '../../ui/Dialog';
import { SongBackupPanel } from '../../SongBackupPanel';
import { PreferSongAction } from '../../SearchPreferences';
import { Cover, displayTitle, Badge, artworkKey } from '../shared';
import { useWorkspace } from '../workspace-context';

/** 操作弹窗：歌单新建／改名／删除、备份、粘贴链接、歌曲与分 P、睡眠定时。 */
export function ActionModal() {
  const {
    popup,
    linkWork,
    actionWork,
    authorWork,
    setAuthorBusy,
    setActionBusy,
    setPopup,
    playback,
    desktop,
    mutate,
    field,
    setField,
    saving,
    lib,
    updateLibrary,
    resolveLink,
    linkBusy,
    setLinkBusy,
    sourceBlocked,
    isFavorite,
    favorite,
    error,
    metadataBusy,
    actionBusy,
    snapshot,
    partPreferences,
    groupSource,
    authorBusy,
    openCreator,
    client,
    followState,
    setFollowState,
    trackAuthors,
    setTrackAuthors,
    attachingSong,
    searchPreferencesChanged,
    notice,
    noticeAction,
    setError,
    setMetadataRetry,
    reload,
    pending,
    retryWrite,
    trackAction,
    startPlayback,
    flash,
    saveParts,
    choosePartMode,
    mode,
    rememberPartMode,
  } = useWorkspace();
  const Popup = popup?.type === 'new' || popup?.type === 'rename' ? Dialog : Modal;
  return (
    <>
      {popup && (
        <Popup
          mobilePage={popup.type === 'backup' || popup.type === 'maintenance'}
          className={
            ['track', 'parts'].includes(popup.type)
              ? 'music-action-modal'
              : popup.type === 'sleep'
                ? 'sleep-modal'
                : popup.type === 'backup'
                  ? 'backup-modal'
                  : popup.type === 'maintenance'
                    ? 'maintenance-modal'
                    : 'form-modal'
          }
          title={
            {
              new: '新建歌单',
              rename: '歌单改名',
              delete: '删除歌单',
              backup: '备份与恢复',
              maintenance: '失效歌曲管理',
              link: '粘贴链接',
              parts: '歌曲与分 P',
              track: '歌曲与分 P',
              sleep: '睡眠定时器',
            }[popup.type]
          }
          onClose={() => {
            linkWork.current?.abort();
            actionWork.current?.abort();
            authorWork.current?.abort();
            setAuthorBusy(false);
            setActionBusy(false);
            setPopup(null);
          }}
        >
          {popup.type === 'sleep' && <SleepPanel timer={playback.sleepTimer} desktop={desktop} />}
          {['new', 'rename'].includes(popup.type) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mutate({
                  edits: [
                    popup.type === 'new'
                      ? { type: 'create-playlist', name: field.trim() }
                      : { type: 'rename-playlist', playlistId: popup.id, name: field.trim() },
                  ],
                });
              }}
            >
              <label className="field">
                <span className="field-label">歌单名称</span>
                <input
                  className="input"
                  data-autofocus="true"
                  value={field}
                  onChange={(e) => setField(e.target.value)}
                  maxLength={200}
                  required
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setPopup(null)}>
                  取消
                </button>
                <button className="btn btn-primary" disabled={!field.trim() || saving}>
                  {saving ? '保存中…' : '保存歌单'}
                </button>
              </div>
            </form>
          )}
          {popup.type === 'delete' && (
            <>
              <p>
                删除歌单“{lib?.snapshot.playlists.find((p) => p.id === popup.id)?.name}
                ”及其条目？当前播放队列保留。
              </p>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setPopup(null)}>
                  取消
                </button>
                <button
                  className="btn btn-danger"
                  disabled={saving}
                  onClick={() =>
                    void mutate({ edits: [{ type: 'delete-playlist', playlistId: popup.id }] })
                  }
                >
                  确认删除
                </button>
              </div>
            </>
          )}
          {popup.type === 'backup' && lib && <SongBackupPanel library={lib} onCommitted={updateLibrary} />}
          {popup.type === 'link' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void resolveLink();
              }}
            >
              <p className="muted">
                支持库可识别的 B站 BV、完整视频链接、YouTube 视频和公开歌单链接。短链及其它 URL 会明确拒绝。
              </p>
              <label className="field">
                <span className="field-label">视频 / 歌单链接</span>
                <input
                  className="input"
                  aria-label="视频或歌单链接"
                  data-autofocus="true"
                  value={field}
                  onChange={(e) => setField(e.target.value)}
                  placeholder="https://… 或 BV…"
                  required
                />
              </label>
              <div className="modal-actions">
                <button className="btn btn-primary" disabled={linkBusy || !field}>
                  {linkBusy ? '解析中…' : '读取真实元信息'}
                </button>
                {linkBusy && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      linkWork.current?.abort();
                      setLinkBusy(false);
                    }}
                  >
                    取消
                  </button>
                )}
              </div>
            </form>
          )}
          {['track', 'parts'].includes(popup.type) && popup.track && sourceBlocked(popup.track) && (
            <div className="disabled-track-actions">
              <h3>{popup.track.title}</h3>
              <p className="muted">YouTube 已关闭。歌曲资料保留，可在设置中重新开启。</p>
              <div className="toolbar">
                {isFavorite(popup.track) && (
                  <button
                    className="btn btn-secondary"
                    disabled={saving}
                    onClick={() => favorite(popup.track!, true, 'part')}
                  >
                    取消收藏
                  </button>
                )}
              </div>
              {error && <p role="alert">{error}</p>}
            </div>
          )}
          {['track', 'parts'].includes(popup.type) && popup.track && !sourceBlocked(popup.track) && (
            <PartsPanel
              mobile={!desktop}
              key={popup.session}
              track={popup.track}
              parts={popup.parts ?? []}
              playlists={lib?.snapshot.playlists ?? []}
              intent={popup.intent ?? (popup.type === 'parts' ? 'parts' : 'overview')}
              targetId={popup.targetId}
              anchorId={popup.anchorId}
              step={popup.step}
              loading={metadataBusy || !popup.parts}
              busy={saving || actionBusy || playback.preparing || snapshot.loading}
              decisionStale={!!popup.anchorId && snapshot.currentId !== popup.anchorId}
              preference={partPreferences[popup.track.ref.id]}
              isFavorite={isFavorite}
              renderRow={(t) => <TrackRow key={t.resourceId} track={t} context="part" />}
              intro={
                <div className="collection-intro track-intro">
                  <Cover track={popup.track} />
                  <div>
                    <h3 title={popup.track.title}>{displayTitle(popup.track)}</h3>
                    {popup.track.unavailable && (
                      <p className="error-text">{availabilityText(popup.track.unavailable)}</p>
                    )}
                    <div className="track-intro-meta">
                      <span className="track-intro-creator">
                        <CreatorContent track={popup.track} />
                      </span>
                      <span className="track-intro-duration">{time(popup.track.durationSeconds)}</span>
                      <Badge provider={popup.track.ref.provider} />
                    </div>
                  </div>
                </div>
              }
              more={
                <>
                  <button
                    className="btn btn-secondary song-group-entry"
                    onClick={() => groupSource(popup.track!)}
                  >
                    <PlusIcon size={19} />
                    归入歌曲 · 添加版本
                  </button>
                  <div className="action-list">
                    <button
                      className="btn btn-secondary"
                      disabled={authorBusy}
                      onClick={() => void openCreator(popup.track!)}
                    >
                      <UsersIcon size={19} />
                      {authorBusy ? '读取作者中…' : '查看 UP / 博主'}
                    </button>
                    <FollowTrackButton
                      key={key(popup.track.ref)}
                      client={client}
                      track={popup.track}
                      state={followState}
                      onChange={setFollowState}
                      author={trackAuthors[artworkKey(popup.track)]}
                      onResolved={(author) =>
                        setTrackAuthors((old) => ({ ...old, [artworkKey(popup.track!)]: author }))
                      }
                    />
                    <a
                      className="btn btn-secondary"
                      href={popup.track.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <LinkIcon size={18} />
                      查看来源
                    </a>
                  </div>
                  {popup.searchSong && !attachingSong && (
                    <PreferSongAction
                      key={key(popup.track.ref)}
                      song={popup.searchSong}
                      track={popup.track}
                      onChanged={searchPreferencesChanged}
                    />
                  )}
                  {attachingSong && (
                    <div className="settings-group">
                      <h3>添加到「{attachingSong.title}」</h3>
                      <button
                        className="btn btn-primary"
                        disabled={saving}
                        onClick={() =>
                          void mutate(
                            {
                              save: {
                                refs: [popup.track!.ref],
                                target: 'version',
                                songId: attachingSong.id,
                              },
                            },
                            false,
                          )
                        }
                      >
                        将此来源添加为歌曲版本
                      </button>
                    </div>
                  )}
                </>
              }
              feedback={
                <>
                  {notice && (
                    <div className="action-notice" role="status">
                      {notice}
                      {noticeAction && (
                        <button className="btn btn-ghost btn-sm" onClick={noticeAction.run}>
                          {noticeAction.label}
                        </button>
                      )}
                    </div>
                  )}
                  {!desktop && (playback.preparing || snapshot.loading) && (
                    <div className="feedback" role="status">
                      <p>正在准备音轨…</p>
                      <button className="btn btn-ghost" onClick={playback.cancel}>
                        取消播放准备
                      </button>
                    </div>
                  )}
                  {(error || (!desktop && playback.error)) && (
                    <div className="feedback" data-tone="error" role="alert">
                      <p>{error || playback.error}</p>
                      {!popup.parts && (
                        <button
                          className="btn btn-ghost"
                          disabled={metadataBusy}
                          onClick={() => {
                            setError('');
                            setMetadataRetry((value) => value + 1);
                          }}
                        >
                          重试读取歌曲
                        </button>
                      )}
                      <button className="btn btn-ghost" onClick={() => void reload()}>
                        重读资料 / 检查服务
                      </button>
                      {pending && (
                        <button className="btn btn-ghost" disabled={saving} onClick={retryWrite}>
                          重试保留编辑
                        </button>
                      )}
                    </div>
                  )}
                  <PlaybackSlot />
                </>
              }
              playSingle={() =>
                trackAction(popup.track!, 'play', popup.origin, popup.entryContext ?? 'video')
              }
              addSingle={() => trackAction(popup.track!, 'add', undefined, popup.entryContext ?? 'video')}
              favoriteSingle={() => favorite(popup.track!, true, popup.entryContext ?? 'video')}
              play={async (parts) => {
                const ok = await startPlayback(() => playback.playAll(parts), false);
                if (ok && !desktop) flash(`已开始播放 ${parts.length} 首`);
                return !!ok;
              }}
              add={async (parts) => {
                const ok = await playback.addAll(parts);
                if (ok) flash(`已加入队尾 ${parts.length} 首`);
                return ok;
              }}
              save={saveParts}
              choose={choosePartMode}
              changePreference={(mode) => rememberPartMode(popup.track!.ref.id, mode)}
            />
          )}
          {error && !['track', 'parts'].includes(popup.type) && (
            <div className="feedback" data-tone="error" role="alert">
              <p>{error}</p>
              <button className="btn btn-ghost" onClick={() => void reload()}>
                重读资料 / 检查服务
              </button>
              {pending && (
                <button className="btn btn-ghost" disabled={saving} onClick={retryWrite}>
                  重试保留编辑
                </button>
              )}
            </div>
          )}
        </Popup>
      )}
    </>
  );
}
