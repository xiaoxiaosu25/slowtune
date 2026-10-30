import { useEffect, useRef } from 'react';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { Modal } from './Modal';
import { errorText, time } from './api';
import { parseLyrics } from '../server/lyrics-format';
import { lyricTextBytes } from '../server/lyrics-types';
import type { LyricsController } from './useLyrics';
import { DesktopLyricFont } from './DesktopLyricFont';
import { LyricOffsetControls } from './LyricOffsetControls';
import type { LyricCandidate } from '../server/lyrics-types';
import './lyric-picker.css';

const labels = { netease: '网易云', lrclib: 'LRCLIB', local: '手动导入' };

export function LyricsSettings({ lyrics, desktopImmersive = false, nativeDesktop = false, embedded = false }: { lyrics: LyricsController; desktopImmersive?: boolean; nativeDesktop?: boolean; embedded?: boolean }) {
  const searchInput = useRef<HTMLInputElement>(null);
  const picker=useRef<HTMLDivElement>(null),previewHeading=useRef<HTMLHeadingElement>(null);
  const previewOrigin=useRef<{button:HTMLElement;listTop:number;body:HTMLElement|null;bodyTop:number}|undefined>(undefined);
  const previewRequested=useRef(false);
  useEffect(() => { if (lyrics.settings && lyrics.selector) searchInput.current?.focus({ preventScroll: true }); }, [lyrics.settings, lyrics.selector]);
  useEffect(()=>{if(lyrics.preview&&previewRequested.current){previewRequested.current=false;previewHeading.current?.focus({preventScroll:true});previewHeading.current?.scrollIntoView({block:'nearest'});}},[lyrics.preview]);
  const { state, document, durationSeconds, offsetMs, busy, error, stale, matched, selector, setSelector,
    title, setTitle, artist, setArtist, text, setText, results, preview,
    run, cancel, load, resolve, search, inspect, accept, importText, clear } = lyrics;
  if (!lyrics.settings) return null;
  const candidates=results?.candidates.filter(candidate=>lyrics.providerFilter==='all'||candidate.provider===lyrics.providerFilter)??[];
  const inspectCandidate=(candidate:LyricCandidate,button:HTMLElement)=>{
    const body=button.closest<HTMLElement>('.playback-management-body,dialog');
    previewOrigin.current={button,listTop:picker.current?.scrollTop??0,body,bodyTop:body?.scrollTop??0};previewRequested.current=true;
    void inspect(candidate);
  };
  const returnToCandidates=()=>{
    if(busy==='预览')cancel();previewRequested.current=false;
    lyrics.setPreview(undefined);const origin=previewOrigin.current;
    requestAnimationFrame(()=>{if(origin?.body)origin.body.scrollTop=origin.bodyTop;if(picker.current)picker.current.scrollTop=origin?.listTop??0;if(origin?.button.isConnected)origin.button.focus({preventScroll:true});});
  };
  const url = document && document.provider !== 'local' ? document.provider === 'netease' ? 'https://music.163.com/#/song?id=' + document.id : 'https://lrclib.net/api/get/' + document.id : undefined;
  const feedback = <>
    {busy && <div className="lyrics-feedback" role="status"><span>正在{busy}歌词…</span><button className="btn btn-ghost" onClick={cancel}>取消</button></div>}
    {error && <div className="lyrics-feedback feedback" data-tone="error" role="alert"><span>{error}</span>{stale ? <button className="btn btn-secondary" disabled={!!busy} onClick={() => void load(true)}>重读当前歌词</button> : <button className="btn btn-ghost" disabled={!!busy} onClick={() => void resolve()}>重试读取歌词</button>}</div>}
  </>;
  const displaySettings = <>
    {desktopImmersive && !nativeDesktop && <label className="choice"><input type="checkbox" checked={lyrics.bottom} onChange={event => lyrics.updateDisplay({ bottom: event.target.checked })}/>显示底部歌词</label>}
    <label className="choice"><input type="checkbox" checked={lyrics.translations} onChange={event => lyrics.updateDisplay({ translations: event.target.checked })}/>显示翻译</label>
    {desktopImmersive && <DesktopLyricFont/>}
    <p className="muted lyrics-settings-help">{nativeDesktop ? '歌词显示在独立桌面窗口，可通过应用菜单或托盘调整；点击歌曲操作区的“词”打开沉浸歌词。此处的翻译开关用于沉浸歌词。' : desktopImmersive ? '底部歌词独立显示；点击歌曲操作区的“词”打开沉浸歌词。有真实逐字时间时逐字推进，普通 LRC 整句高亮。' : '在播放页点击“歌词”进入完整歌词，再点击“唱片”返回。有逐字时间时准确变色，普通 LRC 按句时长平滑推进。'}</p>
  </>;
  const content = <>
    {selector ? <div className="lyric-picker">
      <button className="btn btn-ghost" onClick={() => { cancel(); setSelector(false); }}>返回歌词设置</button>
      <p className="muted">只为当前播放版本选择歌词。预览不会改变正在使用的歌词。</p>
      <form className="lyrics-search" onSubmit={event => { event.preventDefault(); void search(); }}>
        <label className="field"><span className="field-label">歌名</span><input ref={searchInput} className="input" aria-label="歌词歌名" data-autofocus="true" maxLength={300} required value={title} onChange={e => setTitle(e.target.value)}/></label>
        <label className="field"><span className="field-label">歌手</span><input className="input" aria-label="歌词歌手" maxLength={300} value={artist} onChange={e => setArtist(e.target.value)}/></label>
        <button className="btn btn-primary" disabled={!!busy || !title.trim()}>查找歌词</button>
      </form>
      <details className="lyric-query-alternatives"><summary>调整搜索关键词</summary><p className="muted lyric-query-original">原始标题：{lyrics.originalTitle||'未提供'}</p><div className="toolbar"><button className="btn btn-ghost btn-sm" disabled={!lyrics.originalTitle} onClick={()=>{setTitle(lyrics.originalTitle.slice(0,300));setArtist('');searchInput.current?.focus({preventScroll:true});}}>填入原标题</button><button className="btn btn-ghost btn-sm" onClick={lyrics.resetQuery}>恢复歌名与歌手</button></div></details>
      <div className="segmented lyric-provider-tabs" role="group" aria-label="歌词来源筛选">{(['all','netease','lrclib'] as const).map(provider=><button type="button" key={provider} aria-label={provider==='all'?'全部歌词来源':labels[provider]+'歌词来源'} aria-pressed={lyrics.providerFilter===provider} className={lyrics.providerFilter===provider?'selected':''} onClick={()=>lyrics.setProviderFilter(provider)}>{provider==='all'?'全部':labels[provider]}{results&&<span className="lyric-provider-count">{results.candidates.filter(candidate=>provider==='all'||candidate.provider===provider).length}</span>}</button>)}</div>
      {feedback}
      {results?.issues.map(issue => <p className="notice" key={issue.provider}>{labels[issue.provider]}：{errorText(issue)} 可重新查找。</p>)}
      {results && !results.candidates.length && !(desktopImmersive && busy === '搜索') && <p role="status">没有找到候选，可以修改歌名、歌手，或导入歌词。</p>}
      {!!results?.candidates.length && !candidates.length && <p role="status">这个来源暂时没有候选，可以切换到全部或重新查找。</p>}
      {!!candidates.length && <><div className="lyric-candidate-columns" aria-hidden="true"><span>歌曲与类型</span><span>歌手与专辑</span><span>时长</span><span>预览</span></div><div ref={picker} className="lyrics-candidates" aria-label="歌词候选">{candidates.map(candidate => {
        const difference=candidate.durationSeconds!==undefined&&durationSeconds!==undefined?Math.round((candidate.durationSeconds-durationSeconds)*10)/10:undefined;
        return <div className="lyrics-candidate" key={candidate.provider + ':' + candidate.id} data-preview={preview?.provider===candidate.provider&&preview.id===candidate.id||undefined}>
        <div className="lyric-candidate-name"><strong>{candidate.title}</strong><small>{labels[candidate.provider]} · {candidate.instrumental?'纯音乐':candidate.synced===true?'同步歌词':candidate.synced===false?'纯文本':'时间轴待确认'}</small></div>
        <div className="lyric-candidate-artist"><p>{candidate.artists.join(' / ') || '歌手未知'}</p>{candidate.album&&<small>{candidate.album}</small>}</div>
        <div className="lyric-candidate-duration"><span>{time(candidate.durationSeconds)}</span>{difference!==undefined&&<small data-mismatch={Math.abs(difference)>5||undefined}>{difference===0?'与当前版本等长':`比当前版本${difference>0?'长':'短'} ${Math.abs(difference)} 秒`}</small>}</div>
        <button className="btn btn-secondary" disabled={!!busy && !(desktopImmersive && busy === '搜索')} aria-label={'预览 ' + labels[candidate.provider] + ' ' + candidate.title + ' ' + candidate.id} aria-pressed={preview?.provider === candidate.provider && preview.id === candidate.id} onClick={event => inspectCandidate(candidate,event.currentTarget)}>预览</button>
      </div>;})}</div></>}
      {preview && <section className="lyrics-preview" aria-label="歌词预览"><h3 ref={previewHeading} tabIndex={-1}>{preview.title} · {labels[preview.provider]}</h3><p className="muted">{preview.synced?'同步歌词':'纯文本歌词'}{preview.lines.some(line=>line.translation)?' · 含翻译':''} · 预览未替换当前歌词</p><div tabIndex={0}>{preview.instrumental ? '纯音乐' : preview.lines.map((line, index) => <p key={index}>{line.text || '♪'}{line.translation && <small>{line.translation}</small>}</p>)}</div><div className="toolbar"><button className="btn btn-ghost" onClick={returnToCandidates}>返回候选</button><button className="btn btn-primary" disabled={!!busy || stale || !state} onClick={() => void accept(embedded)}>使用这份歌词</button></div></section>}
      <details className="lyrics-import"><summary>导入或粘贴歌词</summary>
        <label className="field"><span className="field-label">LRC 或 UTF-8 文本文件（最多 128 KiB）</span><input className="input" type="file" aria-label="导入歌词文件" accept=".lrc,.txt,text/plain" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
          void run('读取', async signal => { if (file.size > lyricTextBytes) throw { code: 'invalid-input' }; const value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); parseLyrics(value); if (!signal.aborted) setText(value); });
        }}/></label>
        <label className="field"><span className="field-label">歌词正文</span><textarea className="textarea" aria-label="粘贴歌词正文" rows={6} value={text} onChange={e => setText(e.target.value)} placeholder="[00:12.50] 歌词内容"/></label>
        <button className="btn btn-primary" disabled={!!busy || stale || !state || !text.trim()} onClick={() => void importText(embedded)}>使用导入歌词</button>
      </details>
      {document && <button className="btn btn-ghost" disabled={!!busy || stale} onClick={() => void clear()}>清除当前歌词选择</button>}
    </div> : <>
      {embedded ? <details className="lyrics-display-options"><summary>显示与字号</summary>{displaySettings}</details> : displaySettings}
      {document && <p className="lyrics-source">{document.title} · {matched && '已自动匹配 · '}{url ? <a href={url} target="_blank" rel="noreferrer">{labels[document.provider]}</a> : labels[document.provider]}</p>}
      {embedded && document && <><p className="muted">{document.artists.join(' / ') || '歌手未提供'} · {document.synced ? '有时间轴' : '纯文本歌词'}</p><details className="current-lyrics-text"><summary>查看当前歌词全文</summary><div tabIndex={0}>{document.lines.map((line, index) => <p key={index}>{line.text || '♪'}{line.translation && <small>{line.translation}</small>}</p>)}</div></details></>}
      {!lyrics.track && <p className="muted">播放音乐后自动查找适合当前版本的歌词。</p>}
      {embedded && lyrics.track && !document && <p className="muted">当前版本尚未选择歌词，可以查找或导入。</p>}
      {feedback}
      {document?.synced && <details className="lyrics-offset" open={embedded || !desktopImmersive && window.matchMedia('(max-width:760px)').matches || undefined}><summary>调整歌词时间{offsetMs !== state?.offsetMs ? ' · 未保存' : state?.offsetMs ? ` · ${state.offsetMs / 1000} 秒` : ''}</summary>
        <LyricOffsetControls lyrics={lyrics}/>
      </details>}
      {embedded && document && !document.synced && <p className="muted">这份歌词没有时间轴，可更换或导入带时间轴的歌词后校准。</p>}
      <div className="lyrics-settings-actions"><button className="btn btn-secondary" disabled={!state || !!busy} onClick={() => setSelector(true)}>更换或导入歌词</button><button className="btn btn-ghost" disabled={!lyrics.track || !!busy} onClick={() => void resolve()}><ArrowsClockwiseIcon size={16}/>{document ? '刷新当前歌词' : '重新匹配'}</button></div>
    </>}
  </>;
  return embedded ? <section className="embedded-lyrics-settings" aria-label="当前版本歌词管理">{content}</section> : <Modal mobilePage={!desktopImmersive} title={selector ? '选择歌词' : '歌词设置'} className={selector ? 'lyrics-dialog' : 'lyrics-settings-dialog'} onClose={lyrics.closeSettings}>{content}</Modal>;
}
