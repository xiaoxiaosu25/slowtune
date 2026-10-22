import { useEffect, useState } from 'react';
import { MusicNotesIcon } from '@phosphor-icons/react';
import { errorText } from './api';
import type { DesktopLyricsPreferences } from './desktop-host';

const colors = [
  { label: '暖金', value: '#f4cd87' },
  { label: '薄荷', value: '#a6e9c5' },
  { label: '晴蓝', value: '#a7d8ff' },
  { label: '纯白', value: '#ffffff' },
];

export function DesktopLyricsSettings() {
  const api = window.slowTuneDesktop;
  const [preferences, setPreferences] = useState<DesktopLyricsPreferences>();
  const [fontSize, setFontSize] = useState('32');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => {
    if (!api) return;
    let disposed = false;
    const change = (state: { preferences: DesktopLyricsPreferences }) => { if (!disposed) setPreferences(state.preferences); };
    const unsubscribe = api.onState(change);
    void api.getState().then(change).catch(issue => { if (!disposed) setError(errorText(issue)); });
    return () => { disposed = true; unsubscribe(); };
  }, [api]);
  useEffect(() => { if (preferences) setFontSize(String(preferences.fontSize)); }, [preferences?.fontSize]);
  const update = async (value: Partial<DesktopLyricsPreferences>) => {
    if (!api || busy) return;
    setBusy(true); setError(''); setMessage('');
    const previous = preferences;
    setPreferences(current => current ? { ...current, ...value } : current);
    try { setPreferences((await api.updateLyricsPreferences(value)).preferences); }
    catch (issue) { setPreferences(previous); setError(errorText(issue)); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    if (!api || busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await api.resetLyricsPosition(); setMessage('歌词位置已重置。'); }
    catch (issue) { setError(errorText(issue)); }
    finally { setBusy(false); }
  };
  const saveFontSize = () => {
    const value = Number(fontSize);
    if (Number.isInteger(value) && value >= 18 && value <= 64) { if (value !== preferences?.fontSize) void update({ fontSize: value }); }
    else setFontSize(String(preferences?.fontSize ?? 32));
  };
  if (!api) return null;
  return <div className="settings-stack desktop-floating-settings">
    <header className="settings-section-heading"><div><h3>桌面悬浮歌词</h3><p className="muted">与歌词浮窗共用一套设置，修改后立即生效。</p></div><MusicNotesIcon size={25}/></header>
    {preferences ? <>
      <label className="choice"><input type="checkbox" checked={preferences.visible} disabled={busy} onChange={event => void update({ visible: event.target.checked })}/>显示桌面悬浮歌词</label>
      <section className="settings-group settings-stack">
        <h4>歌词外观</h4>
        <label className="field"><span className="field-label">字号 <output>{preferences.fontSize} 像素</output></span><input className="input" type="number" aria-label="桌面歌词字号" min="18" max="64" step="2" value={fontSize} disabled={busy} onChange={event => setFontSize(event.target.value)} onBlur={saveFontSize} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/></label>
        <div className="field"><span className="field-label">高亮颜色</span><div className="toolbar" role="group" aria-label="桌面歌词高亮颜色">{colors.map(color => <button key={color.value} type="button" className="btn btn-secondary btn-sm" aria-pressed={preferences.highlight === color.value} disabled={busy} onClick={() => void update({ highlight: color.value })}><span className="desktop-lyric-color" style={{ background: color.value }} aria-hidden="true"/>{color.label}</button>)}</div></div>
        <label className="choice"><input type="checkbox" checked={preferences.lines === 2} disabled={busy} onChange={event => void update({ lines: event.target.checked ? 2 : 1 })}/>双行歌词</label>
        <label className="choice"><input type="checkbox" checked={preferences.translations} disabled={busy} onChange={event => void update({ translations: event.target.checked })}/>显示歌词翻译</label>
      </section>
      <section className="settings-group settings-stack">
        <h4>操作与位置</h4>
        <label className="choice"><input type="checkbox" checked={preferences.locked} disabled={busy} onChange={event => void update({ locked: event.target.checked })}/>锁定歌词（鼠标穿透）</label>
        <p className="muted">锁定后，将鼠标停留在歌词文字上，出现解锁按钮后点击即可解锁，也可在这里或系统托盘解锁。其余区域保持鼠标穿透。找不到歌词浮窗时，可以重置位置。</p>
        <div><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void reset()}>重置歌词位置</button></div>
      </section>
    </> : !error && <p className="muted" role="status">正在读取桌面歌词设置…</p>}
    {error && <p className="feedback" role="alert">{error}</p>}
    {message && <p className="muted" role="status">{message}</p>}
  </div>;
}

export function DesktopDataSettings({ onOpenBackup }: { onOpenBackup: () => void }) {
  const [directory, setDirectory] = useState(''), [error, setError] = useState('');
  useEffect(() => { void window.slowTuneDesktop?.getDataDirectory().then(setDirectory).catch(issue => setError(String(issue))); }, []);
  const open = (kind: 'data' | 'logs') => { void window.slowTuneDesktop?.openDirectory(kind).catch(issue => setError(String(issue))); };
  return <div className="settings-stack desktop-data-settings">
    <header className="settings-section-heading"><div><h3>本地资料</h3><p className="muted">你的歌单、收藏与偏好保存在此程序的 data 文件夹。</p></div></header>
    <p className="muted" style={{ overflowWrap: 'anywhere' }}>{directory || '正在读取资料位置…'}</p>
    <div className="settings-form-actions"><button className="btn btn-secondary" onClick={() => open('data')}>打开资料文件夹</button><button className="btn btn-secondary" onClick={() => open('logs')}>打开日志文件夹</button></div>
    <section className="settings-group"><h4>备份与恢复</h4><p className="muted">歌单 JSON 备份只包含歌单、收藏及曲目资料和来源，不包含账号、关注、推荐偏好、来源设置、播放偏好或同步关联。</p><p className="muted">完整备份请先退出慢听，确认关闭完成后复制整个 data 文件夹。恢复时先退出，再将完整备份放回资料位置；已有资料先另行保留，不合并目录。更新程序时保留 data。</p><button className="btn btn-secondary" onClick={onOpenBackup}>歌单 JSON 导入与导出</button></section>
    <p className="muted">桌面资料与服务版各自保存。B站凭据由当前 Windows 用户加密保存在 data 中；换电脑或 Windows 用户后可能需要重新登录。</p><p className="muted">关闭主窗口或选择“退出慢听”会停止播放，完成必要保存并关闭本应用的内部服务；最小化可继续播放。退出应用保留账号登录。</p>{error&&<p className="feedback" data-tone="error" role="alert">{error}</p>}
  </div>;
}
