import { useState } from 'react';
import { RefreshButton } from './ListActions';
import { errorText, type BilibiliAccountState, type ServerStatus } from './api';
import type { SongLibraryState } from '../server/song-library-types';
import { desktopDiagnostics, diagnosticErrorCode } from './desktop-diagnostics';

export function DesktopRuntimePanel({ status, checkedAt, account, library, onRefresh, onStopPlayback, onOpenSources, onOpenAccount, onOpenAbout }: {
  status?: ServerStatus; checkedAt?: number; account?: BilibiliAccountState; library: SongLibraryState | null;
  onRefresh(): Promise<void>; onStopPlayback(): Promise<boolean | undefined>; onOpenSources(): void; onOpenAccount(): void; onOpenAbout(): void;
}) {
  const [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [refreshFailed, setRefreshFailed] = useState(false), [operationError, setOperationError] = useState('');
  const run = async (action: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(action); setMessage(''); setError('');
    try { await work(); } catch (issue) { setError(errorText(issue)); setOperationError(diagnosticErrorCode(issue)); }
    finally { setBusy(''); }
  };
  const youtube = status?.providers?.youtube;
  const accountLabel = account ? ({ authenticated: '账号已登录', anonymous: '未登录 · 匿名使用', expired: '登录已过期', unavailable: '账号状态无法读取' }[account.state]) : '未知';
  return <div className="diagnostics-settings settings-stack">
    <header className="settings-section-heading"><div><h3>运行信息</h3><p className="muted">查看本应用的运行与来源状态；实际搜索和播放需要分别验证。</p></div><RefreshButton label="刷新诊断" busy={busy === 'refresh'} busyLabel="检查中…" disabled={!!busy} onClick={() => void run('refresh', async () => {
      try { await onRefresh(); setRefreshFailed(false); setOperationError(''); setMessage('运行信息已更新。'); }
      catch (issue) { setRefreshFailed(true); throw issue; }
    })}/></header>
    <p className="muted diagnostics-checked-at">{checkedAt ? `最近取得运行信息：${new Date(checkedAt).toLocaleString('zh-CN', { hour12: false })}` : '尚未取得运行信息'}{refreshFailed ? ' · 本次检查失败，保留上次信息' : ''}</p>
    <dl className="service-overview">
      <div><dt>B站账号</dt><dd>{accountLabel}<button className="settings-text-link" onClick={onOpenAccount}>管理B站账号</button></dd></div>
      <div><dt>YouTube</dt><dd>{!youtube ? '未知' : youtube.enabled === false ? '已关闭' : youtube.checking ? '正在检查工具' : youtube.available ? '取源工具可用' : '当前不可用'}<button className="settings-text-link" onClick={onOpenSources}>管理音乐来源</button></dd></div>
      <div><dt>歌单与收藏</dt><dd>{library ? `${library.snapshot.playlists.length} 个歌单 · ${library.snapshot.favorites.length} 首收藏` : '未知'}</dd></div>
    </dl>
    {status?.build?.stale && <p className="feedback">程序已更新，请退出后重新打开慢听。</p>}
    <section className="settings-group"><h4>诊断复制</h4><p className="muted">复制版本、运行环境、来源状态与错误分类。缺失信息标为未知；不含凭据、媒体地址、账号身份或私人路径，不自动上传。</p><button className="btn btn-secondary" disabled={!!busy} onClick={() => void run('copy', async () => {
      let runtime;
      try { runtime = await window.slowTuneDesktop!.getRuntimeInfo(); } catch { /* unknown fields remain explicit */ }
      await window.slowTuneDesktop!.copyDiagnostics(desktopDiagnostics({ runtime, status, account, checkedAt, refreshFailed, operationError }));
      setMessage('诊断信息已复制。');
    })}>{busy === 'copy' ? '正在复制…' : '复制诊断信息'}</button></section>
    <div className="settings-action-row"><p className="muted">停止播放并释放资源，保留当前队列。</p><button className="btn btn-secondary" disabled={!!busy} onClick={() => void run('stop', async () => { if (!await onStopPlayback()) throw new Error('未能停止播放，请重试。'); setMessage('播放已停止。'); })}>停止播放</button></div>
    {(message || error) && <p className="feedback" data-tone={error ? 'error' : undefined} role={error ? 'alert' : 'status'}>{error || message}</p>}
    <details className="settings-details"><summary>高级运行信息</summary><dl className="diagnostics"><dt>应用版本</dt><dd>{status?.version ?? '未知'}</dd><dt>内部服务环境</dt><dd>{status?.node ? `Node.js ${status.node}` : '未知'}</dd><dt>本机资源</dt><dd>媒体读取 {status?.delivery?.activeReads ?? '未知'} · 取源任务 {status?.tool?.active ?? '未知'}</dd></dl></details>
    <p className="muted">队列、模式和音量保存在本应用的 data 文件夹；播放进度不持久化。关闭主窗口会停止播放并退出，最小化可继续播放。<button className="settings-text-link" onClick={onOpenAbout}>查看来源、隐私与开源声明</button></p>
  </div>;
}
