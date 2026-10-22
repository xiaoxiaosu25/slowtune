import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { LoginChallenge, LoginStatus } from '@studio/music-sources';
import { cancelled, errorText, request, type BilibiliAccountState } from './api';
import { Avatar } from './Avatar';
import { RefreshButton } from './ListActions';

export function BilibiliAccountControls({ status, onChange, onOpenAbout }: { status?: BilibiliAccountState; onChange: (status: BilibiliAccountState) => void; onOpenAbout?: () => void }) {
  const desktop = !!window.slowTuneDesktop;
  const [challenge, setChallenge] = useState<LoginChallenge>();
  const [qr, setQr] = useState('');
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const action = useRef<AbortController | undefined>(undefined);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => () => { action.current?.abort(); void request('/api/bilibili/cancel', {}).catch(() => {}); }, []);
  useEffect(() => {
    if (!challenge) return;
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const intervalMs = Math.max(2000, challenge.intervalMs);
    let retryDelay = intervalMs;
    let retrying = false;
    setQr('');
    void QRCode.toDataURL(challenge.url, { width: 240, margin: 4, errorCorrectionLevel: 'M' }).then(value => { if (!c.signal.aborted) setQr(value); }).catch(() => { if (!c.signal.aborted) setError('二维码生成失败，请重新生成。'); });
    const poll = async () => {
      if (Date.now() >= challenge.expiresAt) { finished = false; if (retrying) setError(''); setPhase('二维码已过期，请重新生成。'); setChallenge(undefined); return; }
      try {
        const result = await request<LoginStatus>('/api/bilibili/poll', { id: challenge.id }, c.signal);
        if (c.signal.aborted) return;
        if (retrying) { setError(''); retrying = false; }
        retryDelay = intervalMs;
        if (result.state === 'authenticated' && result.account) {
          finished = true;
          change.current({ state: 'authenticated', account: result.account });
          setPhase('B站账号已登录，正在更新音乐推荐和收藏夹。');
          setChallenge(undefined);
          return;
        }
        if (result.state === 'expired') { finished = true; setPhase('二维码已过期，请重新生成。'); setChallenge(undefined); return; }
        setPhase(result.state === 'scanned' ? '已扫码，请在B站客户端确认登录。' : '请用B站客户端扫码并确认登录。');
      } catch (e) {
        if (c.signal.aborted || cancelled(e)) return;
        const code = (e as { code?: string }).code;
        if (code === 'expired') { if (retrying) setError(''); setPhase('二维码已过期，请重新生成。'); setChallenge(undefined); return; }
        if (code !== 'busy') {
          if (!['network', 'timeout', 'upstream', 'rate-limited'].includes(code ?? '')) { setError(errorText(e)); return; }
          setError(errorText(e) + ' 将自动重试。');
          retrying = true;
          retryDelay = Math.min(retryDelay * 2, 16000);
        }
      }
      if (!c.signal.aborted) timer = setTimeout(() => void poll(), Math.min(retryDelay, Math.max(0, challenge.expiresAt - Date.now())));
    };
    timer = setTimeout(() => void poll(), intervalMs);
    return () => {
      c.abort();
      clearTimeout(timer);
      if (!finished) void request('/api/bilibili/cancel', { id: challenge.id }).catch(() => {});
    };
  }, [challenge]);

  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    action.current?.abort();
    const c = new AbortController(); action.current = c;
    setBusy(true); setError(''); setPhase('');
    try { await work(c.signal); } catch (e) { if (!cancelled(e)) setError(errorText(e)); }
    finally { if (!c.signal.aborted) setBusy(false); }
  };
  const begin = () => run(async signal => {
    const value = await request<LoginChallenge>('/api/bilibili/login', {}, signal);
    if (!signal.aborted) { setChallenge(value); setPhase('请用B站客户端扫码并确认登录。'); }
  });
  const stop = () => run(async signal => {
    if (challenge) await request('/api/bilibili/cancel', { id: challenge.id }, signal);
    setChallenge(undefined); setPhase('已取消扫码登录。');
  });
  const disconnect = () => run(async signal => {
    const value = await request<BilibiliAccountState>('/api/bilibili/disconnect', {}, signal);
    if (!signal.aborted) { setChallenge(undefined); change.current(value); setPhase(desktop ? 'B站账号已退出，已删除本桌面应用保存的登录凭据。' : 'B站账号已退出，已删除此服务保存的登录凭据。'); }
  });
  const refresh = () => run(async signal => {
    const value = await request<BilibiliAccountState>('/api/bilibili/account', undefined, signal);
    if (!signal.aborted) change.current(value);
  });

  return <section className="bilibili-account" aria-labelledby="bilibili-account-heading">
    <h3 id="bilibili-account-heading">B站账号</h3>
    {status?.state === 'authenticated' && status.account ? <div className="platform-profile">
      <Avatar artwork={status.account.artwork} name={status.account.name} className="account-avatar"/>
      <div><strong>{status.account.name}</strong><p className="muted">已登录 · 音乐推荐、音轨与收藏夹</p></div>
    </div> : <p className="muted">{!status ? '正在检查账号状态…' : status.state === 'expired' ? 'B站登录已过期，请重新扫码。' : status.state === 'unavailable' ? status.issue ?? '保存的账号无法读取，请重新扫码登录。' : '未登录 · 使用匿名音乐栏目'}</p>}
    <p className="muted account-description">登录后使用账号音乐推荐与音轨，并可读取收藏夹关联歌单。{desktop ? '此账号与收藏夹关联保存在本桌面应用，与服务版各自保存。' : '同一服务的 PC 和手机共享此账号与收藏夹关联。'}</p>
    <p className="muted account-description">{desktop ? '登录凭据由当前 Windows 用户加密后保存在本应用的 data 中，退出应用会保留登录。' : '登录凭据加密保存在服务所在电脑的 Windows 用户下，不保存在手机中。'}启用收藏夹关联后，歌曲新增与删除会双向同步，可能修改B站收藏夹。{onOpenAbout&&<button className="settings-text-link" onClick={onOpenAbout}>查看账号与隐私说明</button>}</p>
    {challenge && <div className="panel platform-login">
      {qr ? <img className="login-qr" src={qr} alt="B站登录二维码"/> : <p>正在生成二维码…</p>}
      <p className="muted">请用B站客户端扫码。二维码约 3 分钟后过期。</p>
      <div className="toolbar"><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void begin()}>重新生成二维码</button><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void stop()}>取消扫码</button></div>
    </div>}
    {!challenge && <div className="toolbar">
      <button className="btn btn-primary" disabled={busy} onClick={() => void begin()}>{busy ? '正在处理…' : status?.state === 'authenticated' ? '更换B站账号' : '扫码登录 B站'}</button>
      {status?.state === 'authenticated' && <button className="btn btn-secondary danger" disabled={busy} onClick={() => void disconnect()}>退出B站账号</button>}
      <RefreshButton label="检查账号状态" busy={busy} onClick={() => void refresh()}/>
    </div>}
    {phase && <p className="muted account-feedback" role="status">{phase}</p>}
    {error && <p className="error-text account-feedback" role="alert">{error}</p>}
    <p className="muted account-description">本应用使用B站网页内部接口，非开放平台授权 API，可能失效或受风控限制；退出B站账号可删除{desktop ? '本桌面应用' : '此服务'}保存的凭据。</p>
  </section>;
}
