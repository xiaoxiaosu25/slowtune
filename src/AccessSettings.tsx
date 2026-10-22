import { useEffect, useId, useState } from 'react';
import { EyeIcon, EyeSlashIcon, LockKeyIcon } from '@phosphor-icons/react';
import type { AccessState } from '../server/startup-types';
import { errorText, request } from './api';

function AccessCodeField({label,value,onChange,autoComplete,required=false,disabled=false}:{label:string;value:string;onChange:(value:string)=>void;autoComplete:string;required?:boolean;disabled?:boolean}) {
  const [visible,setVisible]=useState(false),id=useId();
  return <label className="field" htmlFor={id}><span className="field-label">{label}</span><span className="welcome-password"><input id={id} className="input" aria-label={label} type={visible?'text':'password'} autoComplete={autoComplete} value={value} onChange={event=>onChange(event.target.value)} required={required} disabled={disabled} maxLength={256}/><button className="btn btn-icon" type="button" aria-label={(visible?'隐藏':'显示')+label} onClick={()=>setVisible(value=>!value)}>{visible?<EyeSlashIcon size={18}/>:<EyeIcon size={18}/>}</button></span></label>;
}

export function AccessSettings({onChanged}:{onChanged:()=>void}) {
  const [state,setState]=useState<AccessState>(),[required,setRequired]=useState(true),[current,setCurrent]=useState(''),[next,setNext]=useState(''),[confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const dirty=!!state&&(required!==state.authenticationRequired||!!next||!!confirmation);
  const read=async()=>{setError('');try{const value=await request<AccessState>('/api/settings/access');setState(value);setRequired(value.authenticationRequired);}catch(issue){setError(errorText(issue));}};
  useEffect(()=>{void read();},[]);
  const save=async()=>{
    if(!state||busy||!dirty)return;setError('');setMessage('');
    if(next&&(next.length<6||!next.trim())){setError('新访问码至少需要 6 个字符，且不能全部为空格。');return;}
    if(next!==confirmation){setError('两次输入的新访问码不一致。');return;}
    setBusy(true);
    try {
      const value=await request<AccessState>('/api/settings/access',{revision:state.revision,authenticationRequired:required,currentAccessKey:current,...(next?{newAccessKey:next}:{})});
      setState(value);setRequired(value.authenticationRequired);setCurrent('');setNext('');setConfirmation('');setMessage('访问设置已保存。当前浏览器保持连接，其他旧会话已失效。');onChanged();
    }catch(issue){setError(errorText(issue));}finally{setBusy(false);}
  };
  return <div className="settings-stack access-settings">
    <header className="settings-section-heading"><div><h3>启动与访问</h3><p className="muted">决定如何进入慢听，也可以在这里修改私人访问码。</p></div><LockKeyIcon size={25}/></header>
    {!state?<><p role="status">{error||'正在读取访问设置…'}</p>{error&&<button className="btn btn-secondary" onClick={()=>void read()}>重新读取</button>}</>:<form className="settings-stack" onSubmit={event=>{event.preventDefault();void save();}}>
      <section className="settings-group settings-stack"><h4>进入方式</h4><label className="choice"><input type="checkbox" checked={required} disabled={busy} onChange={event=>{setRequired(event.target.checked);setMessage('');}}/>进入时验证访问码</label><p className="muted">{required?'没有有效会话时，需要输入访问码。已验证的浏览器会自动连接。':'连接此服务的设备可直接进入，共用歌单、收藏和来源账号。'}</p><p className="muted">欢迎页至少展示约 1.5 秒，同时准备歌单、收藏和首页内容，准备好后自动进入。</p>
        <AccessCodeField label="当前访问码" value={current} onChange={setCurrent} autoComplete="current-password" required disabled={busy}/>
        <p className="muted">保存进入方式或修改访问码，都需要输入当前访问码。</p>
      </section>
      <section className="settings-group settings-stack"><h4>修改访问码</h4><p className="muted">首次访问码来自服务配置。此后在这里修改，重启后仍然生效。关闭验证时也会保留访问码，用于管理访问设置。</p>
        <AccessCodeField label="新访问码（不修改可留空）" value={next} onChange={setNext} autoComplete="new-password" disabled={busy}/>
        <AccessCodeField label="再次输入新访问码" value={confirmation} onChange={setConfirmation} autoComplete="new-password" required={!!next} disabled={busy}/>
        <p className="muted">6–256 个字符。切换验证方式或修改访问码都需要校验当前访问码。</p>
      </section>
      {(error||message)&&<p className="feedback" data-tone={error?'error':undefined} role={error?'alert':'status'}>{error||message}</p>}
      {dirty&&!current&&<p className="muted" role="status">有未保存的修改。请填写上方的当前访问码，再保存设置。</p>}
      <div className="settings-form-actions"><button className="btn btn-primary" type="submit" disabled={busy||!dirty}>{busy?'保存中…':'保存访问设置'}</button><button className="btn btn-ghost" type="button" disabled={busy} onClick={()=>{setRequired(state.authenticationRequired);setCurrent('');setNext('');setConfirmation('');setMessage('');setError('');}}>取消修改</button>{error&&<button className="btn btn-ghost" type="button" disabled={busy} onClick={()=>void read()}>重读当前设置</button>}</div>
    </form>}
  </div>;
}
