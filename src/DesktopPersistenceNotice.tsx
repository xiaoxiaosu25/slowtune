import { useEffect, useState } from 'react';

export function DesktopPersistenceNotice() {
  const [failed, setFailed] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    const api = window.slowTuneDesktop;
    if (!api) return;
    const failed = () => setFailed(true);
    window.addEventListener('desktop-preference-error', failed);
    const off = api.onPreferenceState(state => { if (state.error) setFailed(true); else if (!state.pending) setFailed(false); });
    void api.getRuntimeInfo().then(info => setFailed(!!info.preferences.error)).catch(() => {});
    return () => { off(); window.removeEventListener('desktop-preference-error', failed); };
  }, []);
  if (!window.slowTuneDesktop || !failed) return null;
  return <div className="feedback desktop-persistence-error" role="alert" data-tone="error">
    <span>本地设置（含窗口、歌词和欢迎图）尚未保存，当前修改仍在内存中。请检查磁盘空间和资料目录权限后重试，保存成功前请勿强制关闭。</span>
    <button className="btn btn-secondary" disabled={busy} onClick={() => { setBusy(true); void window.slowTuneDesktop!.flushPreferences().then(() => setFailed(false)).catch(() => setFailed(true)).finally(() => setBusy(false)); }}>{busy ? '正在保存…' : '重试保存偏好'}</button>
  </div>;
}
