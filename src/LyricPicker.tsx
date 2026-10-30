import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { errorText, time } from './api';
import type { LyricsController } from './useLyrics';
import type { LyricCandidate } from '../server/lyrics-types';
import { parseLyrics } from '../server/lyrics-format';
import { lyricTextBytes } from '../server/lyrics-types';
import './lyric-picker.css';

const labels={netease:'网易云',lrclib:'LRCLIB',local:'手动导入'};
const candidateKey=(candidate:Pick<LyricCandidate,'provider'|'id'>)=>candidate.provider+':'+candidate.id;

/** Read-only previews have their own request; progressive search can keep arriving. */
export function LyricPicker({lyrics,playbackControl}:{lyrics:LyricsController;playbackControl?:ReactNode}) {
  const [selected,setSelected]=useState<string>(),[view,setView]=useState<'list'|'preview'|'import'>('list'),[editing,setEditing]=useState(false);
  const searchInput=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null),previewBody=useRef<HTMLDivElement>(null),previewHeading=useRef<HTMLHeadingElement>(null);
  const origin=useRef<HTMLButtonElement|null>(null),focusPreview=useRef(false);
  const {results,preview,previewBusy,previewError,busy}=lyrics;
  const candidates=results?.candidates.filter(candidate=>lyrics.providerFilter==='all'||candidate.provider===lyrics.providerFilter)??[];
  const chosen=candidates.find(candidate=>candidateKey(candidate)===selected);
  const ready=!!chosen&&!!preview&&candidateKey(preview)===selected&&!previewBusy;
  const facts=ready?preview:chosen;
  const previewKind=facts?.instrumental?'纯音乐':facts?.synced===true?'同步歌词':facts?.synced===false?'纯文本歌词':'时间轴待确认';
  const blocked=!!busy&&busy!=='搜索';
  useEffect(()=>{
    if(!candidates.length){setSelected(undefined);return;}
    if(candidates.some(candidate=>candidateKey(candidate)===selected))return;
    const current=lyrics.document&&candidates.find(candidate=>candidateKey(candidate)===candidateKey(lyrics.document!));
    const candidate=current??candidates[0];setSelected(candidateKey(candidate));
    if(!preview||candidateKey(preview)!==candidateKey(candidate))void lyrics.inspect(candidate);
  },[results,lyrics.providerFilter]);
  useEffect(()=>{if(previewBody.current)previewBody.current.scrollTop=0;},[selected]);
  useEffect(()=>{if(view==='preview'&&focusPreview.current){focusPreview.current=false;previewHeading.current?.focus({preventScroll:true});}},[view]);
  const choose=(candidate:LyricCandidate,button:HTMLButtonElement)=>{
    const changed=candidateKey(candidate)!==selected;setSelected(candidateKey(candidate));origin.current=button;
    if(changed||previewError||!preview&&!previewBusy)void lyrics.inspect(candidate);
    if(window.matchMedia('(max-width:900px)').matches){focusPreview.current=true;setView('preview');}
  };
  const back=()=>{setView('list');requestAnimationFrame(()=>{const button=origin.current??list.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');button?.focus({preventScroll:true});});};
  const saving=busy==='保存';
  return <div className="lyric-picker" data-view={view}>
    <div className="lyric-picker-tools" data-editing={editing||undefined}>
      <div className="lyric-query-compact"><span>{lyrics.title}{lyrics.artist&&' · '+lyrics.artist}</span><button className="btn btn-ghost btn-sm" onClick={()=>{setEditing(value=>!value);requestAnimationFrame(()=>searchInput.current?.focus({preventScroll:true}));}}>{editing?'收起搜索':'修改搜索'}</button></div>
      <form className="lyrics-search" onSubmit={event=>{event.preventDefault();setView('list');setEditing(false);setSelected(undefined);void lyrics.search();}}>
        <label className="field"><span className="field-label">歌名</span><input ref={searchInput} className="input" aria-label="歌词歌名" maxLength={300} required value={lyrics.title} onChange={event=>lyrics.setTitle(event.target.value)}/></label>
        <label className="field"><span className="field-label">歌手</span><input className="input" aria-label="歌词歌手" maxLength={300} value={lyrics.artist} onChange={event=>lyrics.setArtist(event.target.value)}/></label>
        <button className="btn btn-primary" disabled={!!busy||!lyrics.title.trim()}>查找歌词</button>
      </form>
      <div className="lyric-picker-filterbar"><div className="segmented lyric-provider-tabs" role="group" aria-label="歌词来源筛选">{(['all','netease','lrclib'] as const).map(provider=><button key={provider} type="button" className={lyrics.providerFilter===provider?'selected':''} aria-pressed={lyrics.providerFilter===provider} aria-label={provider==='all'?'全部歌词来源':labels[provider]+'歌词来源'} onClick={()=>{lyrics.setProviderFilter(provider);setView('list');}}>{provider==='all'?'全部':labels[provider]}{results&&<span className="lyric-provider-count">{results.candidates.filter(candidate=>provider==='all'||candidate.provider===provider).length}</span>}</button>)}</div><button className="btn btn-ghost btn-sm" onClick={()=>{setView('import');setEditing(false);}}><UploadSimpleIcon size={16}/>导入歌词</button></div>
      <details className="lyric-query-alternatives"><summary>调整搜索关键词</summary><p className="muted lyric-query-original">原始标题：{lyrics.originalTitle||'未提供'}</p><div className="toolbar"><button className="btn btn-ghost btn-sm" disabled={!lyrics.originalTitle} onClick={()=>{lyrics.setTitle(lyrics.originalTitle.slice(0,300));lyrics.setArtist('');setEditing(true);requestAnimationFrame(()=>searchInput.current?.focus({preventScroll:true}));}}>填入原标题</button><button className="btn btn-ghost btn-sm" onClick={()=>{lyrics.resetQuery();setEditing(true);}}>恢复歌名与歌手</button></div></details>
      {!!results?.issues.length&&<div className="lyric-provider-issues">{results.issues.map(issue=><span key={issue.provider} title={errorText(issue)}>{labels[issue.provider]}暂不可用</span>)}<button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={()=>void lyrics.search()}>重试</button></div>}
    </div>
    {(lyrics.error||busy)&&<div className="lyric-picker-feedback" role={lyrics.error?'alert':'status'}><span>{lyrics.error||`正在${busy}歌词…`}</span>{lyrics.error?<button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={()=>void (lyrics.stale||!lyrics.state?lyrics.load(true):lyrics.search())}>{lyrics.stale||!lyrics.state?'重读当前歌词':'重试搜索'}</button>:busy!=='保存'&&<button className="btn btn-ghost btn-sm" onClick={lyrics.cancel}>取消</button>}</div>}
    <div className="lyric-picker-content">
      <div className="lyric-candidate-pane" hidden={view==='import'}><div className="lyric-pane-heading"><h3>候选歌词{results&&` · ${candidates.length}`}</h3><small>点选即可查看全文</small></div><div ref={list} className="lyrics-candidates" role="group" aria-label="歌词候选">{candidates.map(candidate=>{
        const difference=candidate.durationSeconds!==undefined&&lyrics.durationSeconds!==undefined?Math.round((candidate.durationSeconds-lyrics.durationSeconds)*10)/10:undefined;
        return <button type="button" className="lyrics-candidate" key={candidateKey(candidate)} disabled={blocked} aria-label={'预览 '+labels[candidate.provider]+' '+candidate.title+' '+candidate.id} aria-pressed={selected===candidateKey(candidate)} onClick={event=>choose(candidate,event.currentTarget)}>
          <span className="lyric-candidate-name"><strong>{candidate.title}</strong><small>{candidate.artists.join(' / ')||'歌手未知'}{candidate.album&&' · '+candidate.album}</small></span>
          <span className="lyric-candidate-duration">{time(candidate.durationSeconds)}{difference!==undefined&&<small data-mismatch={Math.abs(difference)>5||undefined}>{difference===0?'与当前版本等长':`比当前版本${difference>0?'长':'短'} ${Math.abs(difference)} 秒`}</small>}</span>
          <span className="lyric-candidate-type">{labels[candidate.provider]} · {candidate.instrumental?'纯音乐':candidate.synced===true?'同步歌词':candidate.synced===false?'纯文本':'时间轴待确认'}{lyrics.document&&candidateKey(lyrics.document)===candidateKey(candidate)&&' · 正在使用'}</span>
        </button>;
      })}{!candidates.length&&<p className="lyric-picker-empty">{busy==='搜索'?'正在查找候选…':!results?'等待搜索结果':results.candidates.length?'这个来源暂时没有候选，可以切换到全部或重新查找。':'没有找到候选，可以修改歌名、歌手，或导入歌词。'}</p>}</div></div>
      <section className="lyrics-preview" aria-label="歌词预览" hidden={view==='import'} aria-busy={previewBusy}>
        <div className="lyric-preview-heading"><button className="btn btn-ghost btn-sm lyric-preview-back" onClick={back}><ArrowLeftIcon size={16}/>返回候选</button><h3 ref={previewHeading} tabIndex={-1}>{facts?facts.title:'歌词全文'}</h3><p>{chosen?labels[chosen.provider]+' · '+previewKind:'选择候选后在此阅读'}{ready&&preview.lines.some(line=>line.translation)&&' · 含翻译'}</p></div>
        <div ref={previewBody} className="lyric-preview-text" tabIndex={0} aria-label="候选歌词全文">{previewBusy?<div><p role="status">正在读取歌词全文…</p><button className="btn btn-ghost" onClick={lyrics.cancelPreview}>取消预览</button></div>:previewError?<div role="alert"><p>{previewError}</p>{chosen&&<button className="btn btn-secondary" onClick={()=>void lyrics.inspect(chosen)}>重试预览</button>}</div>:ready?preview.instrumental?<p>纯音乐</p>:preview.lines.map((line,index)=><p key={index}>{line.text||'♪'}{line.translation&&<small>{line.translation}</small>}</p>):chosen?<button className="btn btn-secondary" onClick={()=>void lyrics.inspect(chosen)}>读取歌词全文</button>:<p className="muted">在左侧选择一份歌词。</p>}</div>
      </section>
      {view==='import'&&<section className="lyric-import-pane" aria-label="导入歌词"><button className="btn btn-ghost btn-sm" onClick={back}><ArrowLeftIcon size={16}/>返回候选</button><p className="muted">导入后只应用于当前播放版本。</p><label className="field"><span className="field-label">LRC 或 UTF-8 文本文件（最多 128 KiB）</span><input className="input" type="file" aria-label="导入歌词文件" accept=".lrc,.txt,text/plain" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;void lyrics.run('读取',async signal=>{if(file.size>lyricTextBytes)throw{code:'invalid-input'};const value=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());parseLyrics(value);if(!signal.aborted)lyrics.setText(value);});}}/></label><label className="field lyric-import-editor"><span className="field-label">歌词正文</span><textarea className="textarea" aria-label="粘贴歌词正文" value={lyrics.text} onChange={event=>lyrics.setText(event.target.value)} placeholder="[00:12.50] 歌词内容"/></label></section>}
    </div>
    <footer className="lyric-picker-footer"><div className="lyric-picker-footer-context">{playbackControl}<span>{view==='import'?'保存前可核对导入正文':'预览不会替换当前歌词'}</span></div><div className="toolbar"><button className="btn btn-ghost lyric-settings-link" disabled={saving} onClick={()=>{lyrics.cancel();lyrics.cancelPreview();lyrics.setSelector(false);}}>歌词设置</button>{view==='import'?<button className="btn btn-primary" disabled={!!busy||lyrics.stale||!lyrics.state||!lyrics.text.trim()} onClick={()=>void lyrics.importText()}>使用导入歌词</button>:<><button className="btn btn-primary lyric-open-preview" disabled={!chosen} onClick={()=>{focusPreview.current=true;setView('preview');}}>查看歌词</button><button className="btn btn-primary lyric-adopt" disabled={!ready||blocked||lyrics.stale||!lyrics.state} onClick={()=>void lyrics.accept()}>使用这份歌词</button></>}</div></footer>
  </div>;
}
