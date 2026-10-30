import type { LyricsController } from './useLyrics';
import './lyric-offset.css';

export function LyricOffsetControls({lyrics,compact=false}:{lyrics:LyricsController;compact?:boolean}) {
  const {state,offsetMs,offset,setOffset,busy,stale,saveOffset}=lyrics;
  const center=Math.round((state?.offsetMs??0)/1000),min=Math.max(-600,Math.min(-5,center-5)),max=Math.min(600,Math.max(5,center+5));
  const change=(ms:number)=>setOffset(String(Math.round(Math.max(-600000,Math.min(600000,ms)))/1000));
  const dirty=offsetMs!==state?.offsetMs;
  const valid=!!offset.trim()&&Number.isFinite(Number(offset))&&Math.abs(Number(offset))<=600;
  return <div className={'lyric-offset-controls'+(compact?' compact':'')}>
    <p className="lyric-offset-value" role="status">{offsetMs===0?'使用原始时间':`${offsetMs>0?'延后':'提前'} ${(Math.abs(offsetMs)/1000).toFixed(2)} 秒`}<small>{dirty?'正在预览，尚未保存':'已保存'}</small></p>
    <label className="field"><span className="field-label">拖动精调歌词时间</span><input className="lyric-offset-slider" type="range" aria-label="歌词时间精调" min={min} max={max} step="0.05" value={Math.max(min,Math.min(max,offsetMs/1000))} disabled={!!busy||stale||!state} onChange={event=>change(Number(event.target.value)*1000)}/></label>
    <div className="lyrics-offset-buttons"><button type="button" className="btn btn-secondary" disabled={!!busy||stale||!state} onClick={()=>change(offsetMs-50)}>提前 0.05 秒</button><button type="button" className="btn btn-secondary" disabled={!!busy||stale||!state} onClick={()=>change(offsetMs+50)}>延后 0.05 秒</button></div>
    {!compact&&<div className="lyrics-offset-buttons"><button type="button" className="btn btn-secondary" disabled={!!busy||stale||!state} onClick={()=>change(offsetMs-500)}>提前 0.5 秒</button><button type="button" className="btn btn-secondary" disabled={!!busy||stale||!state} onClick={()=>change(offsetMs+500)}>延后 0.5 秒</button></div>}
    <label className="field"><span className="field-label">歌词延后秒数（负数为提前）</span><input className="input" aria-label="歌词延后秒数" type="number" min="-600" max="600" step="0.05" value={offset} disabled={!!busy||stale||!state} onChange={event=>setOffset(event.target.value)}/></label>
    <p className="muted">歌词早了请延后，歌词晚了请提前。{!compact&&'越播偏差越大时，请更换匹配的歌词。'}</p>
    <div className="lyrics-offset-buttons"><button type="button" className="btn btn-ghost" disabled={!!busy||stale||!state} onClick={()=>change(0)}>归零</button>{dirty&&<button type="button" className="btn btn-ghost" disabled={!!busy} onClick={()=>change(state?.offsetMs??0)}>撤销调整</button>}<button type="button" className="btn btn-primary" disabled={!!busy||stale||!state||!valid||!dirty} onClick={()=>void saveOffset()}>保存偏移</button></div>
  </div>;
}
