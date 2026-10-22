import { useEffect, useRef, useState } from 'react';
import { ArrowCounterClockwiseIcon, PushPinIcon, TrashIcon } from '@phosphor-icons/react';
import { request, cancelled, errorText, type Track } from './api';
import { partitionLabels, versionLabels, preferredSong, type SearchSettings, type SearchRule, type SongQuery, type SearchConfig } from '../server/search-policy';

function useSearchSettings(onChanged?:(state:SearchSettings)=>void){
  const [state,setState]=useState<SearchSettings>(),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const work=useRef<AbortController|null>(null);
  useEffect(()=>()=>work.current?.abort(),[]);
  const read=async()=>{
    work.current?.abort();const controller=new AbortController();work.current=controller;setBusy(true);setMessage('');
    try{const result=await request<SearchSettings>('/api/settings/search',undefined,controller.signal);if(!controller.signal.aborted){setState(result);return result;}}
    catch(error){if(!cancelled(error)&&!controller.signal.aborted)setMessage(errorText(error));}
    finally{if(work.current===controller)setBusy(false);}
  };
  const write=async(edit:Record<string,unknown>)=>{
    if(!state||busy)return;
    work.current?.abort();const controller=new AbortController();work.current=controller;setBusy(true);setMessage('');
    try{
      const result=await request<SearchSettings>('/api/settings/search',{...edit,revision:state.revision},controller.signal);
      if(!controller.signal.aborted){setState(result);onChanged?.(result);return result;}
    }catch(error){
      if(!cancelled(error)&&!controller.signal.aborted){
        if((error as {code?:string}).code==='conflict'){
          try{const current=await request<SearchSettings>('/api/settings/search',undefined,controller.signal);if(!controller.signal.aborted)setState(current);}catch{/* Keep the original conflict and draft. */}
        }
        if(!controller.signal.aborted)setMessage(errorText(error));
      }
    }finally{if(work.current===controller)setBusy(false);}
  };
  return {state,busy,message,setMessage,read,write};
}
function RuleSelect({label,value,onChange}:{label:string;value:SearchRule;onChange:(value:SearchRule)=>void}){
  return <label className="field search-rule"><span className="field-label">{label}</span><select className="select" aria-label={label} value={value} onChange={event=>onChange(event.target.value as SearchRule)}><option value="allow">允许自动匹配</option><option value="requested">明确搜索该版本时允许</option><option value="manual">仅手动选择</option></select></label>;
}
export function SearchPreferencesSettings({onChanged}:{onChanged?:(state:SearchSettings)=>void}){
  const settings=useSearchSettings(onChanged),[draft,setDraft]=useState<SearchConfig>(),[exclude,setExclude]=useState(''),[restored,setRestored]=useState(false);
  const stage=(config:SearchConfig)=>{setDraft(structuredClone(config));setExclude(config.excludeTerms.join('\n'));};
  useEffect(()=>{void settings.read().then(state=>{if(state)stage(state.config);});},[]);
  const patch=(value:Partial<SearchConfig>)=>{setDraft(old=>old?{...old,...value}:old);settings.setMessage('');};
  const currentDraft=draft?{...draft,excludeTerms:exclude.split(/\r?\n/).map(term=>term.trim()).filter(Boolean)}:undefined;
  const dirty=!!settings.state&&!!currentDraft&&JSON.stringify(currentDraft)!==JSON.stringify(settings.state.config);
  return <section className="search-preferences" aria-labelledby="search-preferences-heading" aria-busy={settings.busy}>
    <header><h3 id="search-preferences-heading">搜索与自动选歌</h3><p className="muted">保留 B站搜索顺序，只筛选结果。需要自动匹配时，优先使用你选定的结果，再选第一条符合规则的结果。歌曲默认、歌单固定和本次明确选择的版本优先。</p></header>
    {!settings.state&&!settings.message&&<p role="status">正在读取搜索偏好…</p>}
    {draft&&settings.state&&<>
      <fieldset className="field-stack" disabled={settings.busy}>
        <label className="choice"><input type="checkbox" checked={draft.filterByDefault} onChange={event=>patch({filterByDefault:event.target.checked})}/>搜索默认开启筛选</label>
        <p className="muted">搜索时会提示被筛选的数量，可随时显示全部；这个开关不影响直接播放的筛选。</p>
        <label className="choice"><input type="checkbox" checked={draft.strictMatch} onChange={event=>patch({strictMatch:event.target.checked})}/>自动选歌核对歌名和歌手</label>
        <p className="muted">开启时，短歌名缺少歌手信息会交给你选择。所有规则均不改变来源顺序。</p>
        <details className="search-policy-details" open><summary>音乐分区策略</summary><div className="search-rule-grid">{Object.entries(partitionLabels).map(([id,label])=><RuleSelect key={id} label={'分区 · '+label} value={draft.partitions[id as keyof typeof partitionLabels]} onChange={value=>patch({partitions:{...draft.partitions,[id]:value}})}/>)}</div></details>
        <details className="search-policy-details"><summary>版本策略</summary><div className="search-rule-grid">{Object.entries(versionLabels).map(([id,label])=><RuleSelect key={id} label={'版本 · '+label} value={draft.versions[id as keyof typeof versionLabels]} onChange={value=>patch({versions:{...draft.versions,[id]:value}})}/>)}</div></details>
        <label className="field"><span className="field-label">搜索排除词</span><textarea className="textarea" aria-label="搜索排除词" rows={4} value={exclude} onChange={event=>{setExclude(event.target.value);settings.setMessage('');}}/><span className="muted">每行一个，按标题文字匹配。留空则不按关键词排除。</span></label>
      </fieldset>
      <div className="toolbar search-preference-actions">
        <button className="btn btn-ghost" disabled={settings.busy} onClick={()=>{stage(settings.state!.defaults.config);setRestored(true);settings.setMessage('默认配置已载入，保存后生效。已指定的版本会保留。');}}><ArrowCounterClockwiseIcon size={18}/>恢复默认配置</button>
        <button className="btn btn-secondary" disabled={settings.busy||!dirty&&!restored} onClick={()=>{stage(settings.state!.config);setRestored(false);settings.setMessage('');}}>取消修改</button>
        <button className="btn btn-primary" disabled={settings.busy||!dirty&&!restored} onClick={()=>void settings.write({action:'config',config:currentDraft}).then(state=>{if(state){stage(state.config);setRestored(false);settings.setMessage('搜索偏好已保存。');}})}>保存搜索偏好</button>
      </div>
      <p className="muted">{dirty?'有未保存的修改。':window.slowTuneDesktop?'保存在本桌面应用的 data 中，与服务版各自保存。':'同一服务的电脑和手机共用。'}{settings.state.defaultsVersion!==settings.state.defaults.version?' 有新版默认配置，可通过恢复默认载入。':''}</p>
      <details className="search-policy-details"><summary>自动匹配的优先结果（{settings.state.preferred.length}）</summary>
        {!settings.state.preferred.length&&<p className="muted">在搜索结果的更多操作里选择“自动匹配时优先选此结果”。</p>}
        <ul className="preferred-song-list">{settings.state.preferred.map(item=><li key={item.key}><div><strong>{item.song.title}{item.song.artists?.length?' · '+item.song.artists.join(' / '):''}</strong><span>{item.entry.title} · {item.entry.uploader?.name??(item.entry.ref.provider==='bilibili'?'B站':'YouTube')}</span></div><button className="btn btn-icon" aria-label={'取消指定版本 '+item.song.title} disabled={settings.busy} onClick={()=>void settings.write({action:'remove',key:item.key}).then(state=>{if(state)settings.setMessage('已取消指定版本。');})}><TrashIcon size={18}/></button></li>)}</ul>
      </details>
    </>}
    {settings.message&&<p className="notice" role="status">{settings.message}</p>}
    {!settings.state&&settings.message&&<button className="btn btn-secondary" disabled={settings.busy} onClick={()=>void settings.read().then(state=>{if(state)stage(state.config);})}>重试读取搜索偏好</button>}
  </section>;
}
export function PreferSongAction({song,track,onChanged}:{song:SongQuery;track:Track;onChanged:(state:SearchSettings)=>void}){
  const settings=useSearchSettings(onChanged),[expanded,setExpanded]=useState(false),[title,setTitle]=useState(song.title),[artists,setArtists]=useState(song.artists?.join(' / ')??'');
  const target:SongQuery={title:title.trim(),...(artists.trim()?{artists:artists.split(/\s*\/\s*|[，,、]/).map(value=>value.trim()).filter(Boolean)}:{})};
  const saved=settings.state?preferredSong(settings.state.preferred,target):undefined;
  return <div className="prefer-song-action">
    <button className="btn btn-secondary" aria-expanded={expanded} onClick={()=>{setExpanded(value=>!value);if(!expanded)void settings.read();}}><PushPinIcon size={18}/>自动匹配时优先选此结果</button>
    {expanded&&<form className="field-stack preferred-song-form" onSubmit={event=>{event.preventDefault();void settings.write({action:'prefer',song:target,ref:track.ref}).then(state=>{if(state)settings.setMessage('已保存，自动匹配时优先选择此结果；歌曲默认与歌单固定版本继续优先。');});}}>
      <label className="field"><span className="field-label">适用歌名／搜索词</span><input className="input" aria-label="优先版本适用名称" value={title} maxLength={512} required onChange={event=>setTitle(event.target.value)}/></label>
      <label className="field"><span className="field-label">歌手（可选）</span><input className="input" aria-label="优先版本歌手" value={artists} maxLength={1000} onChange={event=>setArtists(event.target.value)} placeholder="留空则适用于所有同名搜索"/></label>
      <p className="muted">仅用于没有明确播放版本时的自动匹配。要改变已保存歌曲的常用版本，请在歌曲窗口中设置默认版本。</p>
      <p className="muted">{artists.trim()?'只用于此歌名和歌手。':'未指定歌手，将用于所有同名搜索；歌名和歌手均匹配的指定版本优先。'} {track.ref.part?'保存当前这一 P。':'多 P 视频默认保存第一 P，可先在分 P 列表中选择。'}</p>
      {saved&&<p className="muted">当前指定：{saved.entry.title}</p>}
      <div className="toolbar"><button className="btn btn-primary" disabled={settings.busy||!settings.state||!target.title}>保存匹配偏好</button>{saved&&<button type="button" className="btn btn-ghost" disabled={settings.busy} onClick={()=>void settings.write({action:'remove',key:saved.key}).then(state=>{if(state)settings.setMessage('已取消指定版本。');})}>取消指定版本</button>}</div>
      {settings.message&&<p className="notice" role="status">{settings.message}</p>}
    </form>}
  </div>;
}
