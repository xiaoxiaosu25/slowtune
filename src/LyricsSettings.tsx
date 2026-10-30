import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Modal } from './Modal';
import type { LyricsController } from './useLyrics';
import { DesktopLyricFont } from './DesktopLyricFont';
import { DesktopLyricMotion } from './DesktopLyricMotion';
import { LyricOffsetControls } from './LyricOffsetControls';
import { LyricPicker } from './LyricPicker';

export function LyricsSettings({lyrics,desktopImmersive=false,nativeDesktop=false,playbackControl}:{lyrics:LyricsController;desktopImmersive?:boolean;nativeDesktop?:boolean;playbackControl?:ReactNode}) {
  if(!lyrics.settings)return null;
  const {document,state,busy,error,stale,offsetMs}=lyrics;
  if(lyrics.selector)return <Modal mobilePage={!desktopImmersive} title="选择歌词" className="lyrics-dialog lyric-picker-dialog" onClose={lyrics.closeSettings}><LyricPicker key={lyrics.sourceKey} lyrics={lyrics} playbackControl={playbackControl}/></Modal>;
  const url=document&&document.provider!=='local'?document.provider==='netease'?'https://music.163.com/#/song?id='+document.id:'https://lrclib.net/api/get/'+document.id:undefined;
  return <Modal mobilePage={!desktopImmersive} title="歌词设置" className="lyrics-settings-dialog" onClose={lyrics.closeSettings}>
    {desktopImmersive&&!nativeDesktop&&<label className="choice"><input type="checkbox" checked={lyrics.bottom} onChange={event=>lyrics.updateDisplay({bottom:event.target.checked})}/>显示底部歌词</label>}
    <label className="choice"><input type="checkbox" checked={lyrics.translations} onChange={event=>lyrics.updateDisplay({translations:event.target.checked})}/>显示翻译</label>
    {desktopImmersive&&<><DesktopLyricFont/><DesktopLyricMotion lyrics={lyrics}/></>}
    {document&&<p className="lyrics-source">{document.title} · {lyrics.matched&&'已自动匹配 · '}{url?<a href={url} target="_blank" rel="noreferrer">{document.provider==='netease'?'网易云':'LRCLIB'}</a>:'手动导入'}</p>}
    {!lyrics.track&&<p className="muted">播放音乐后自动查找适合当前版本的歌词。</p>}
    {busy&&<div className="lyrics-feedback" role="status"><span>正在{busy}歌词…</span>{busy!=='保存'&&<button className="btn btn-ghost" onClick={lyrics.cancel}>取消</button>}</div>}
    {error&&<div className="lyrics-feedback feedback" data-tone="error" role="alert"><span>{error}</span><button className="btn btn-ghost" disabled={!!busy} onClick={()=>void (stale||!state?lyrics.load(true):lyrics.resolve())}>{stale||!state?'重读当前歌词':'重试读取歌词'}</button></div>}
    {document?.synced&&<details className="lyrics-offset" open={!desktopImmersive||undefined}><summary>调整歌词时间{offsetMs!==state?.offsetMs?' · 未保存':state?.offsetMs?` · ${state.offsetMs/1000} 秒`:''}</summary><LyricOffsetControls lyrics={lyrics}/></details>}
    <div className="lyrics-settings-actions"><button className="btn btn-secondary" disabled={!lyrics.track||!!busy} onClick={lyrics.openSelector}>更换或导入歌词</button><button className="btn btn-ghost" disabled={!lyrics.track||!!busy} onClick={()=>void lyrics.resolve()}><ArrowsClockwiseIcon size={16}/>{document?'刷新当前歌词':'重新匹配'}</button>{document&&<button className="btn btn-ghost" disabled={!!busy||stale} onClick={()=>void lyrics.clear()}>清除当前歌词选择</button>}</div>
  </Modal>;
}
