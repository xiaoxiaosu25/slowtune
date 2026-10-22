import { useState } from 'react';
import { request, errorText } from './api';
import type { SourceSettingsState, DisabledDisplay } from './source-settings';

export function SourceSettings({state,onChanged,onOpenAbout}:{state?:SourceSettingsState;onChanged:(value:SourceSettingsState)=>void;onOpenAbout?:()=>void}){
  const desktop=!!window.slowTuneDesktop;
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [draft,setDraft]=useState<{enabled?:boolean;disabledDisplay?:DisabledDisplay}>();
  async function save(patch:{enabled?:boolean;disabledDisplay?:DisabledDisplay}){
    if(!state)return;setDraft(patch);setBusy(true);setMessage('');
    try{const value=await request<SourceSettingsState>('/api/settings/sources',{revision:state.revision,youtube:{enabled:state.youtube.enabled,disabledDisplay:state.youtube.disabledDisplay,...patch}});onChanged(value);setMessage('已保存，立即生效。');}
    catch(error){setMessage((error as {code?:string}).code==='conflict'?'其他页面已修改音乐来源，请重新读取后再设置。':errorText(error));}
    finally{setDraft(undefined);setBusy(false);}
  }
  return <div className="source-settings" aria-busy={busy}>
    <h3>音乐来源</h3><p className="muted">YouTube 需要能够访问其服务的网络环境，按需开启。{desktop?'此设置保存在本桌面应用的 data 中，与服务版各自保存。':'电脑和手机共用此设置。'}</p>
    <p className="source-access-notice muted">YouTube 目录由 YouTube.js 接入，播放资源由{desktop?'本机配置的':'服务电脑上的'} yt-dlp 解析，均为第三方工具。访问受平台条款、内容权限及网络条件限制。{onOpenAbout&&<button className="settings-text-link" onClick={onOpenAbout}>查看来源与许可说明</button>}</p>
    {!state?<p role="status">正在读取音乐来源设置…</p>:<>
      <label className="source-setting-toggle"><span><strong>启用 YouTube</strong><small>发现、搜索、作者内容、评论和播放</small></span><input type="checkbox" role="switch" aria-label="启用 YouTube" checked={draft?.enabled??state.youtube.enabled} disabled={busy} onChange={event=>void save({enabled:event.target.checked})}/></label>
      <label className="field"><span className="field-label">关闭时已有歌曲的展示方式</span><select className="select" aria-label="关闭时已有歌曲的展示方式" value={draft?.disabledDisplay??state.youtube.disabledDisplay} disabled={busy} onChange={event=>void save({disabledDisplay:event.target.value as DisabledDisplay})}><option value="show">正常显示</option><option value="dim">变灰</option><option value="hide">隐藏</option></select></label>
      <p className="muted">用于收藏、歌单和播放队列。关闭时无法播放 YouTube 歌曲，混合队列会自动跳过；资料始终保留。</p>
      <p role="status">{!state.youtube.enabled?'YouTube 已关闭':state.youtube.checking?'正在检查 YouTube 取源工具…':state.youtube.available?`YouTube 已开启 · yt-dlp ${state.youtube.toolVersion??''}`:`YouTube 已开启，但当前不可用：${state.youtube.issue??'请检查取源工具'}`}</p>
      {state.youtube.enabled&&!state.youtube.checking&&!state.youtube.available&&<button className="btn btn-secondary" disabled={busy} onClick={async()=>{setBusy(true);try{onChanged(await request<SourceSettingsState>('/api/settings/sources/youtube/check',{}));}catch(error){setMessage(errorText(error));}finally{setBusy(false);}}}>重新检查 YouTube</button>}
    </>}
    {message&&<p className="feedback" role="status">{message}{message.includes('其他页面')&&<button className="btn btn-ghost" onClick={async()=>{try{onChanged(await request<SourceSettingsState>('/api/settings/sources'));setMessage('已读取最新设置。');}catch(error){setMessage(errorText(error));}}}>重新读取设置</button>}</p>}
  </div>;
}
