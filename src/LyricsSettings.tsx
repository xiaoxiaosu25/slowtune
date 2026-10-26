import { useEffect, useRef } from 'react';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { Modal } from './Modal';
import { errorText, time } from './api';
import { parseLyrics } from '../server/lyrics-format';
import { lyricTextBytes } from '../server/lyrics-types';
import type { LyricsController } from './useLyrics';
import { DesktopLyricFont } from './DesktopLyricFont';

const labels = { netease: '网易云', lrclib: 'LRCLIB', local: '手动导入' };

export function LyricsSettings({ lyrics, desktopImmersive = false, nativeDesktop = false, embedded = false }: { lyrics: LyricsController; desktopImmersive?: boolean; nativeDesktop?: boolean; embedded?: boolean }) {
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (lyrics.settings && lyrics.selector) searchInput.current?.focus({ preventScroll: true }); }, [lyrics.settings, lyrics.selector]);
  const { state, document, durationSeconds, offsetMs, busy, error, stale, matched, selector, setSelector,
    title, setTitle, artist, setArtist, text, setText, offset, setOffset, results, preview,
    run, cancel, load, resolve, search, inspect, accept, importText, saveOffset, clear } = lyrics;
  if (!lyrics.settings) return null;
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
    {selector ? <>
      <button className="btn btn-ghost" onClick={() => { cancel(); setSelector(false); }}>返回歌词设置</button>
      <p className="muted">只为当前播放版本选择歌词。预览不会改变正在使用的歌词。</p>
      <form className="lyrics-search" onSubmit={event => { event.preventDefault(); void search(); }}>
        <label className="field"><span className="field-label">歌名</span><input ref={searchInput} className="input" aria-label="歌词歌名" data-autofocus="true" maxLength={300} required value={title} onChange={e => setTitle(e.target.value)}/></label>
        <label className="field"><span className="field-label">歌手</span><input className="input" aria-label="歌词歌手" maxLength={300} value={artist} onChange={e => setArtist(e.target.value)}/></label>
        <button className="btn btn-primary" disabled={!!busy || !title.trim()}>查找歌词</button>
      </form>
      {feedback}
      {results?.issues.map(issue => <p className="notice" key={issue.provider}>{labels[issue.provider]}：{errorText(issue)} 可重新查找。</p>)}
      {results && !results.candidates.length && !(desktopImmersive && busy === '搜索') && <p role="status">没有找到候选，可以修改歌名、歌手，或导入歌词。</p>}
      {!!results?.candidates.length && <div className="lyrics-candidates" aria-label="歌词候选">{results.candidates.map(candidate => <div className="lyrics-candidate" key={candidate.provider + ':' + candidate.id}>
        <div><strong>{candidate.title}</strong><p>{candidate.artists.join(' / ') || '歌手未知'}{candidate.album ? ' · ' + candidate.album : ''}</p><small>{labels[candidate.provider]} · {time(candidate.durationSeconds)}{candidate.durationSeconds && durationSeconds && Math.abs(candidate.durationSeconds - durationSeconds) > 5 ? ' · 时长有差异' : ''}{candidate.instrumental ? ' · 纯音乐' : candidate.synced === false ? ' · 纯文本' : ''}</small></div>
        <button className="btn btn-secondary" disabled={!!busy && !(desktopImmersive && busy === '搜索')} aria-label={'预览 ' + labels[candidate.provider] + ' ' + candidate.title + ' ' + candidate.id} aria-pressed={preview?.provider === candidate.provider && preview.id === candidate.id} onClick={() => void inspect(candidate)}>预览</button>
      </div>)}</div>}
      {preview && <section className="lyrics-preview" aria-label="歌词预览"><h3>{preview.title} · {labels[preview.provider]}</h3><div tabIndex={0}>{preview.instrumental ? '纯音乐' : preview.lines.map((line, index) => <p key={index}>{line.text || '♪'}{line.translation && <small>{line.translation}</small>}</p>)}</div><button className="btn btn-primary" disabled={!!busy || stale || !state} onClick={() => void accept(embedded)}>使用这份歌词</button></section>}
      <details className="lyrics-import"><summary>导入或粘贴歌词</summary>
        <label className="field"><span className="field-label">LRC 或 UTF-8 文本文件（最多 128 KiB）</span><input className="input" type="file" aria-label="导入歌词文件" accept=".lrc,.txt,text/plain" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
          void run('读取', async signal => { if (file.size > lyricTextBytes) throw { code: 'invalid-input' }; const value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); parseLyrics(value); if (!signal.aborted) setText(value); });
        }}/></label>
        <label className="field"><span className="field-label">歌词正文</span><textarea className="textarea" aria-label="粘贴歌词正文" rows={6} value={text} onChange={e => setText(e.target.value)} placeholder="[00:12.50] 歌词内容"/></label>
        <button className="btn btn-primary" disabled={!!busy || stale || !state || !text.trim()} onClick={() => void importText(embedded)}>使用导入歌词</button>
      </details>
      {document && <button className="btn btn-ghost" disabled={!!busy || stale} onClick={() => void clear()}>清除当前歌词选择</button>}
    </> : <>
      {embedded ? <details className="lyrics-display-options"><summary>显示与字号</summary>{displaySettings}</details> : displaySettings}
      {document && <p className="lyrics-source">{document.title} · {matched && '已自动匹配 · '}{url ? <a href={url} target="_blank" rel="noreferrer">{labels[document.provider]}</a> : labels[document.provider]}</p>}
      {embedded && document && <><p className="muted">{document.artists.join(' / ') || '歌手未提供'} · {document.synced ? '有时间轴' : '纯文本歌词'}</p><details className="current-lyrics-text"><summary>查看当前歌词全文</summary><div tabIndex={0}>{document.lines.map((line, index) => <p key={index}>{line.text || '♪'}{line.translation && <small>{line.translation}</small>}</p>)}</div></details></>}
      {!lyrics.track && <p className="muted">播放音乐后自动查找适合当前版本的歌词。</p>}
      {embedded && lyrics.track && !document && <p className="muted">当前版本尚未选择歌词，可以查找或导入。</p>}
      {feedback}
      {document?.synced && <details className="lyrics-offset" open={embedded || !desktopImmersive && window.matchMedia('(max-width:760px)').matches || undefined}><summary>调整歌词时间{offsetMs !== state?.offsetMs ? ' · 未保存' : state?.offsetMs ? ` · ${state.offsetMs / 1000} 秒` : ''}</summary>
        <p className="muted">让歌词与当前版本对齐，正数表示延后。</p>
        <div className="lyrics-offset-buttons"><button className="btn btn-secondary" onClick={() => setOffset(String(Math.max(-600, offsetMs / 1000 - .5)))}>提前 0.5 秒</button><button className="btn btn-secondary" onClick={() => setOffset(String(Math.min(600, offsetMs / 1000 + .5)))}>延后 0.5 秒</button></div>
        {embedded && <p className="lyrics-offset-preview" role="status">{offsetMs === 0 ? '使用原始时间' : `已${offsetMs > 0 ? '延后' : '提前'} ${Math.abs(offsetMs / 1000).toFixed(1)} 秒`}{offsetMs !== state?.offsetMs ? ' · 正在预览，尚未保存' : ' · 已保存'}<br/>歌词早了请延后，歌词晚了请提前。越播偏差越大时，请更换匹配的歌词。</p>}
        <label className="field"><span className="field-label">歌词延后秒数（负数为提前）</span><input className="input" aria-label="歌词延后秒数" type="number" min={-600} max={600} step={.1} value={offset} onChange={e => setOffset(e.target.value)}/></label>
        <div className="lyrics-offset-buttons"><button className="btn btn-ghost" onClick={() => setOffset('0')}>归零</button><button className="btn btn-primary" disabled={!!busy || stale || !offset.trim() || !Number.isFinite(Number(offset)) || Math.abs(offsetMs) > 600000 || offsetMs === state?.offsetMs} onClick={() => void saveOffset()}>保存偏移</button></div>
      </details>}
      {embedded && document && !document.synced && <p className="muted">这份歌词没有时间轴，可更换或导入带时间轴的歌词后校准。</p>}
      <div className="lyrics-settings-actions"><button className="btn btn-secondary" disabled={!state || !!busy} onClick={() => setSelector(true)}>更换或导入歌词</button><button className="btn btn-ghost" disabled={!lyrics.track || !!busy} onClick={() => void resolve()}><ArrowsClockwiseIcon size={16}/>{document ? '刷新当前歌词' : '重新匹配'}</button></div>
    </>}
  </>;
  return embedded ? <section className="embedded-lyrics-settings" aria-label="当前版本歌词管理">{content}</section> : <Modal mobilePage={!desktopImmersive} title={selector ? '选择歌词' : '歌词设置'} className={selector ? 'lyrics-dialog' : 'lyrics-settings-dialog'} onClose={lyrics.closeSettings}>{content}</Modal>;
}
