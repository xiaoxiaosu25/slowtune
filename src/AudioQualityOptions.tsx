import {useEffect,useRef,useState} from 'react';
import {audioPreferences,type AudioPreference,type AudioSelection} from '../server/audio-selection';
import {audioQualityLabel} from './audio-quality';
import {errorText} from './api';
import {Modal} from './Modal';
import type {usePlayback} from './playback';
import './audio-quality.css';
type Playback=ReturnType<typeof usePlayback>;
export function AudioPreferenceSelect({playback}:{playback:Playback}){
  return <label className="field audio-preference"><span className="field-label">默认音质</span><select className="select" aria-label="默认音质" value={playback.audioPreference} onChange={event=>playback.setAudioPreference(event.target.value as AudioPreference)}>{Object.entries(audioPreferences).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><small>用于后续播放，当前歌曲保持原选择。</small></label>;
}
export function AudioQualityDialog({playback,generation,onClose}:{playback:Playback;generation:string;onClose:()=>void}){
  const current=playback.snapshot.audioSelection,ref=playback.snapshot.current?.ref,identity=playback.snapshot.currentId?JSON.stringify([playback.snapshot.currentId,ref?.provider,ref?.kind,ref?.id,ref?.part]):undefined;
  const value=(choice:AudioSelection|undefined)=>choice?.formatId?'format:'+choice.formatId:'preference:'+(choice?.preference??'auto');
  const [choice,setChoice]=useState(()=>value(current)),[formats,setFormats]=useState<Awaited<ReturnType<Playback['availableAudio']>>>([]),[loading,setLoading]=useState(false),[issue,setIssue]=useState(''),[message,setMessage]=useState(''),[revision,setRevision]=useState(0);
  const owner=useRef(0);
  const pendingApply=useRef<AbortController|null>(null);
  const canApply=!!identity&&!['idle','stopped','loading'].includes(playback.snapshot.state);
  useEffect(()=>()=>pendingApply.current?.abort(),[]);
  useEffect(()=>{setChoice(value(current));setMessage('');},[identity,current?.preference,current?.formatId]);
  useEffect(()=>{const controller=new AbortController(),serial=++owner.current;setLoading(true);setIssue('');setFormats([]);void playback.availableAudio(controller.signal).then(rows=>{if(!controller.signal.aborted&&owner.current===serial)setFormats(rows);}).catch(error=>{if(!controller.signal.aborted&&owner.current===serial)setIssue(errorText(error));}).finally(()=>{if(!controller.signal.aborted&&owner.current===serial)setLoading(false);});return()=>{controller.abort();owner.current++;};},[identity,generation,revision]);
  const apply=async()=>{
    if(pendingApply.current)return;
    const controller=new AbortController(),serial=owner.current;
    pendingApply.current=controller;
    setIssue('');setMessage('');
    const selection:AudioSelection=choice.startsWith('format:')?{preference:current?.preference??playback.audioPreference,formatId:choice.slice(7)}:{preference:choice.slice(11) as AudioPreference};
    try{
      const result=await playback.changeAudio(selection,controller);
      if(controller.signal.aborted||owner.current!==serial)return;
      if(result)setMessage('音质选择已更新。');
      else setIssue('所选音轨未能应用，请重试或选择兼容优先。');
    }finally{pendingApply.current=null;}
  };
  const close=()=>{pendingApply.current?.abort();onClose();};
  return <Modal title="音质与音轨" className="audio-quality-dialog" onClose={close}>
    <div className="audio-quality-content"><AudioPreferenceSelect playback={playback}/>
      <section aria-label="当前播放音质"><h3>当前播放</h3><p className="audio-quality-current" role="status">{audioQualityLabel(playback.snapshot.format)||'尚未取得音轨信息'}</p><p className="muted">{current?.formatId?'本次指定音轨':audioPreferences[current?.preference??'auto']} · 来源音轨规格</p></section>
      <label className="field"><span className="field-label">本次播放选择</span><select className="select" aria-label="本次播放选择" value={choice} onChange={event=>{setChoice(event.target.value);setMessage('');}} disabled={playback.preparing}>
        {Object.entries(audioPreferences).map(([key,label])=><option key={key} value={'preference:'+key}>{label}</option>)}
        {formats.map(({format,supported})=><option key={format.id} value={'format:'+format.id} disabled={!supported}>{audioQualityLabel(format)}{supported?'':'（当前客户端不支持）'}</option>)}
        {current?.formatId&&!formats.some(row=>row.format.id===current.formatId)&&<option value={'format:'+current.formatId}>本次指定音轨{loading?'（读取中）':'（未在本次列表中取得）'}</option>}
      </select></label>
      <p className="muted">应用到当前歌曲会保留播放进度和暂停状态。指定音轨不可用时会提示失败。</p>
      <p className="muted">这里只显示来源提供的规格，不代表输出设备规格；未提供的采样率、位深和声道不会推测补全。</p>
      {loading&&<p role="status">正在读取可用音轨…</p>}{(issue||playback.error)&&<p className="feedback" role="alert">{issue||playback.error}</p>}{message&&<p role="status">{message}</p>}
      <div className="audio-quality-actions"><button type="button" className="btn btn-secondary" disabled={loading||playback.preparing} onClick={()=>setRevision(value=>value+1)}>重读音轨</button><button type="button" className="btn btn-primary" disabled={!canApply||playback.preparing||loading} onClick={()=>void apply()}>{playback.preparing?'正在准备…':'应用到当前曲'}</button></div>
    </div>
  </Modal>;
}
