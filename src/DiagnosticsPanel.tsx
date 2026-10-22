import { useEffect, useRef, useState } from 'react';
import { RefreshButton } from './ListActions';
import { errorText, type BilibiliAccountState, type ServerStatus } from './api';
import type { SongLibraryState as LibraryData } from '../server/song-library-types';
import { DesktopRuntimePanel } from './DesktopRuntimePanel';

export function DiagnosticsPanel({ status, checkedAt, account, library, onRefresh, onStopPlayback, onLogout, onOpenBackup, onOpenSources, onOpenAccount, onOpenAbout }: {
  status?: ServerStatus; checkedAt?: number; account?: BilibiliAccountState; library: LibraryData | null;
  onRefresh: () => Promise<void>; onStopPlayback: () => Promise<boolean | undefined>; onLogout: () => Promise<void>;
  onOpenBackup: () => void; onOpenSources: () => void; onOpenAccount: () => void; onOpenAbout: () => void;
}) {
  const [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [refreshFailed, setRefreshFailed] = useState(false), working = useRef(false);
  useEffect(() => { setRefreshFailed(false); }, [checkedAt]);
  const run = async (action: string, work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(action); setMessage(''); setError('');
    try { await work(); } catch (issue) { setError(errorText(issue)); }
    finally { working.current = false; setBusy(''); }
  };
  const refresh = () => run('refresh', async () => {
    try { await onRefresh(); setRefreshFailed(false); setMessage('已更新服务状态。来源的实际搜索和播放需要分别验证。'); }
    catch (issue) { setRefreshFailed(true); throw issue; }
  });
  const youtube = status?.providers.youtube;
  const desktop = !!window.slowTuneDesktop;
  const youtubeLabel = !youtube ? '未读取' : youtube.checking ? '正在检查工具' : youtube.available ? '取源工具可用' : youtube.enabled === false ? '已关闭' : '当前不可用';
  const accountLabel = !account ? '未读取' : ({ authenticated: '账号已登录', anonymous: '未登录 · 匿名使用', expired: '登录已过期', unavailable: '账号状态无法读取' }[account.state]);
  if (desktop) return <DesktopRuntimePanel status={status} checkedAt={checkedAt} account={account} library={library} onRefresh={onRefresh} onStopPlayback={onStopPlayback} onOpenSources={onOpenSources} onOpenAccount={onOpenAccount} onOpenAbout={onOpenAbout}/>;
  return <div className="diagnostics-settings settings-stack">
    <header className="settings-section-heading"><div><h3>诊断与数据</h3><p className="muted">查看服务信息、备份资料或处理播放问题。</p></div><RefreshButton label="刷新诊断" busy={busy === 'refresh'} busyLabel="检查中…" disabled={!!busy} onClick={() => void refresh()}/></header>
    <p className="muted diagnostics-checked-at">{checkedAt ? `最近取得服务信息：${new Date(checkedAt).toLocaleString('zh-CN', { hour12: false })}` : '尚未取得服务信息'}{refreshFailed ? ' · 本次检查失败，保留上次信息' : ''}</p>
    {status?.build?.stale && <p className="feedback" role="status">磁盘上有更新的构建，重启服务后生效。请在服务电脑上重启慢听，再刷新页面。</p>}
    <dl className="service-overview">
      <div><dt>服务连接</dt><dd>{refreshFailed ? '本次检查失败' : status ? '最近读取成功' : '等待检查'}<p>仅表示服务响应，不代表所有来源可用。</p></dd></div>
      <div><dt>B站账号</dt><dd>{accountLabel}<button className="settings-text-link" onClick={onOpenAccount}>检查或管理B站账号</button></dd></div>
      <div><dt>YouTube</dt><dd>{youtubeLabel}{youtube?.enabled !== false && !youtube?.available && youtube?.issue && <p>{youtube.issue}</p>}<button className="settings-text-link" onClick={onOpenSources}>管理音乐来源</button></dd></div>
      <div><dt>歌单与收藏</dt><dd>{library ? `${library.snapshot.playlists.length} 个歌单 · ${library.snapshot.favorites.length} 首收藏` : '尚未读取资料'}<p>资料读取不等同于数据库完整性检查。</p></dd></div>
    </dl>
    {(message || error) && <p className="feedback" data-tone={error ? 'error' : undefined} role={error ? 'alert' : 'status'}>{error || message}</p>}

    <section className="settings-group" aria-labelledby="backup-settings-heading"><h4 id="backup-settings-heading">备份与恢复</h4><p className="muted">备份歌单、收藏与曲目来源资料。电脑和手机连接同一个服务时共享这些资料；全部替换会影响这些设备。</p><button className="btn btn-secondary" onClick={onOpenBackup}>备份与恢复</button><p className="muted">备份不包含音乐文件、登录凭据、关注、推荐偏好、来源设置或收藏夹同步关联。</p></section>
    <section className="settings-group" aria-labelledby="playback-recovery-heading"><h4 id="playback-recovery-heading">播放与连接</h4><div className="settings-action-row"><div><strong>停止播放</strong><p className="muted">停止当前播放器并释放播放资源，保留播放队列。</p></div><button className="btn btn-secondary" aria-label="停止播放并释放来源" disabled={!!busy} onClick={() => void run('stop', async () => { if (!await onStopPlayback()) { setError('未能完成停止播放，请重试。'); return; } setMessage('已停止当前播放器并释放播放资源，队列保留。'); })}>{busy === 'stop' ? '停止中…' : '停止播放'}</button></div>
      {!desktop&&status?.authenticationRequired!==false&&<div className="settings-action-row"><div><strong>退出当前浏览器登录</strong><p className="muted">停止当前播放器，重新进入需要服务访问码。服务端B站登录仍保留。</p></div><button className="btn btn-secondary" disabled={!!busy} onClick={() => void run('logout', onLogout)}>{busy === 'logout' ? '退出中…' : '退出当前浏览器登录'}</button></div>}
    </section>
    <details className="settings-details diagnostics-advanced"><summary>高级诊断与播放策略</summary>
      <dl className="diagnostics">
        <dt>应用版本</dt><dd>{status?.version ?? '未取得诊断'}</dd>
        <dt>运行环境</dt><dd>{status ? `Node.js ${status.node}` : '未取得诊断'}</dd>
        <dt>构建状态</dt><dd>{status?.build ? status.build.stale ? '磁盘上有更新的构建，重启服务后生效' : '与运行中的服务一致' : '未取得诊断'}</dd>
        <dt>存储方式</dt><dd><span>服务端 SQLite 条件事务</span><span className="diagnostic-note">此项为实现说明，未执行数据库写入或完整性检查。</span></dd>
        <dt>全服务资源</dt><dd>{status ? `来源凭证 ${status.delivery.leases} · 媒体读取 ${status.delivery.activeReads} · 取源任务 ${status.tool.active}` : '未知'}<span className="diagnostic-note">包含其他设备的任务；非零数值不一定表示异常。</span></dd>
        <dt>播放策略</dt><dd>自动选择来源提供且浏览器支持的音轨，无损优先，其余选择最高码率。<span className="diagnostic-note">这是选择策略，实际音质以播放器显示为准。</span></dd>
        <dt>YouTube 工具</dt><dd>{youtube?.available ? `yt-dlp ${youtube.toolVersion ?? '版本未知'}` : youtube?.issue ?? youtubeLabel}</dd>
      </dl>
    </details>
    <p className="muted">{desktop?'队列、模式和音量保存在本机 data 文件夹；播放进度不持久化。':'队列、模式和音量保存在当前浏览器；播放进度不持久化。'}<button className="settings-text-link" onClick={onOpenAbout}>查看来源、隐私与开源声明</button></p>
  </div>;
}
