import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRightIcon, SpinnerGapIcon, UploadSimpleIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { defaultWelcome, type WelcomeState, type WelcomeSettings as WelcomeOptions } from '../server/startup-types';
import { errorText, request } from './api';
import { getThemeState, subscribeTheme } from './theme';
import { WelcomeScreen } from './WelcomeScreen';

async function prepareImage(file:File) {
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>12*1024*1024)throw new Error('请选择不超过 12 MiB 的 JPG、PNG 或 WebP 图片。');
  const bitmap=await createImageBitmap(file);
  try {
    if(bitmap.width*bitmap.height>60_000_000)throw new Error('图片尺寸过大，请先缩小后重新选择。');
    const ratio=Math.min(1,2560/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const image=canvas.toDataURL('image/webp',.86);
    if(image.length>4*1024*1024)throw new Error('压缩后的图片仍超过 3 MiB，请选择更小的图片。');
    return image;
  }finally{bitmap.close();}
}

export function WelcomeSettings() {
  const [state,setState]=useState<WelcomeState>(),[draft,setDraft]=useState<WelcomeOptions>(defaultWelcome),[image,setImage]=useState<string>();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[device,setDevice]=useState<'desktop'|'mobile'>('desktop'),[previewLogin,setPreviewLogin]=useState(false),[previewTheme,setPreviewTheme]=useState<'light'|'dark'>('light');
  const [width,setWidth]=useState(0),host=useRef<HTMLDivElement>(null),serial=useRef(0),mounted=useRef(true),drag=useRef<{x:number;y:number;focus:{x:number;y:number}}|null>(null);
  const theme=useSyncExternalStore(subscribeTheme,getThemeState);
  const read=async()=>{setError('');try{const value=await request<WelcomeState>('/api/settings/welcome');if(!mounted.current)return;setState(value);setDraft(value.welcome);setImage(undefined);}catch(issue){if(mounted.current)setError(errorText(issue));}};
  useEffect(()=>{mounted.current=true;void read();return()=>{mounted.current=false;++serial.current;};},[]);
  useEffect(()=>{const element=host.current;if(!element)return;const observer=new ResizeObserver(()=>setWidth(element.clientWidth));observer.observe(element);setWidth(element.clientWidth);return()=>observer.disconnect();},[state]);
  const change=(patch:Partial<WelcomeOptions>)=>{setDraft(value=>({...value,...patch}));setMessage('');};
  const focusKey=device==='desktop'?'desktopFocus':'mobileFocus',focus=draft[focusKey];
  const updateFocus=(x:number,y:number)=>change({[focusKey]:{x:Math.max(0,Math.min(100,Math.round(x))),y:Math.max(0,Math.min(100,Math.round(y)))}});
  const save=async()=>{
    if(!state||busy)return;setBusy(true);setError('');setMessage('');
    try{const value=await request<WelcomeState>('/api/settings/welcome',{revision:state.revision,welcome:draft,...(image?{image}:{})});setState(value);setDraft(value.welcome);setImage(undefined);await cacheDesktopWelcome(value.welcome);setMessage(window.slowTuneDesktop?'欢迎页已保存，下次打开慢听时生效。':'欢迎页已保存，连接此服务的设备下次打开时生效。');}catch(issue){setError(errorText(issue));}finally{setBusy(false);}
  };
  const logicalWidth=device==='desktop'?1200:390,logicalHeight=800,scale=width/logicalWidth;
  return <div className="settings-stack welcome-settings">
    <header className="settings-section-heading"><div><h3>欢迎页</h3><p className="muted">选一张喜欢的图片，让每次打开都有自己的风景。</p></div></header>
    {!state?<><p role="status">{error||'正在读取欢迎页…'}</p>{error&&<button className="btn btn-secondary" onClick={()=>void read()}>重新读取</button>}</>:<>
      <section className="settings-group settings-stack"><h4>背景图片</h4><div className="segmented" role="group" aria-label="欢迎页背景来源">{([['builtin','内置风景'],['custom','自定义图片'],['plain','纯色']] as const).map(([value,label])=><button key={value} disabled={busy||value==='custom'&&!image&&!draft.imageId} aria-pressed={draft.background===value} className={draft.background===value?'selected':''} onClick={()=>change({background:value})}>{label}</button>)}</div>
        <label className="field"><span className="field-label">上传欢迎图</span><input className="input" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;const id=++serial.current;setBusy(true);setError('');setMessage('');try{const value=await prepareImage(file);if(id!==serial.current)return;setImage(value);change({background:'custom'});}catch(issue){if(id===serial.current)setError((issue as Error).message);}finally{if(id===serial.current)setBusy(false);}}}/></label>
        <p className="muted">支持 JPG、PNG、WebP，原图不超过 12 MiB。保存前会缩小并重新编码。{window.slowTuneDesktop?'欢迎图保存在此程序的本地资料中。':'欢迎图在登录前可见，连接此服务的设备都能看到。'}</p>
      </section>
      <section className="settings-group settings-stack"><div className="welcome-preview-toolbar"><h4>预览与构图</h4>{!window.slowTuneDesktop&&<div className="segmented" role="group" aria-label="预览设备"><button className={device==='desktop'?'selected':''} aria-pressed={device==='desktop'} onClick={()=>setDevice('desktop')}>电脑</button><button className={device==='mobile'?'selected':''} aria-pressed={device==='mobile'} onClick={()=>setDevice('mobile')}>手机</button></div>}</div>
        <div className="welcome-preview-toolbar"><div className="segmented" role="group" aria-label="预览主题"><button className={previewTheme==='light'?'selected':''} aria-pressed={previewTheme==='light'} onClick={()=>setPreviewTheme('light')}>白天</button><button className={previewTheme==='dark'?'selected':''} aria-pressed={previewTheme==='dark'} onClick={()=>setPreviewTheme('dark')}>黑夜</button></div>{!window.slowTuneDesktop&&<label className="choice"><input type="checkbox" checked={previewLogin} onChange={event=>setPreviewLogin(event.target.checked)}/>预览访问码表单</label>}</div>
        <div className={'welcome-preview-frame '+device} ref={host} style={{height:width?width*logicalHeight/logicalWidth:240}} aria-label={device==='desktop'?'电脑欢迎页预览':'手机欢迎页预览'} onPointerDown={event=>{if(busy||draft.background==='plain')return;drag.current={x:event.clientX,y:event.clientY,focus:{...focus}};event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(!drag.current)return;updateFocus(drag.current.focus.x-(event.clientX-drag.current.x)/Math.max(1,width)*100,drag.current.focus.y-(event.clientY-drag.current.y)/Math.max(1,width*logicalHeight/logicalWidth)*100);}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
          <div aria-hidden="true" className="theme-preview welcome-preview-scene" data-palette={theme.palette} data-theme={previewTheme} style={{width:logicalWidth,height:logicalHeight,transform:`scale(${scale||.01})`}}><WelcomeScreen settings={draft} image={draft.background==='custom'?image:undefined} preview>{previewLogin?<div className="welcome-login"><div className="field"><span className="field-label">服务访问码</span><span className="input welcome-preview-input">输入访问码，进入你的音乐空间</span></div><span className="btn btn-primary welcome-enter">进入音乐空间<ArrowRightIcon size={19}/></span><span className="muted">访问码是什么？</span></div>:<div className="welcome-status"><div className="welcome-loading"><SpinnerGapIcon size={22}/><span>正在准备你的音乐…</span></div><p className="muted">准备好后将自动进入</p></div>}</WelcomeScreen></div>
        </div>
        <p className="muted">在预览上拖动图片，或用下方滑块调整{device==='desktop'?'电脑':'手机'}构图{window.slowTuneDesktop?'。':'；两种构图分别保存。'}</p>
        <div className="welcome-range-grid"><label className="field"><span className="field-label">水平焦点 · {focus.x}%</span><input type="range" min="0" max="100" value={focus.x} disabled={busy||draft.background==='plain'} onChange={event=>updateFocus(Number(event.target.value),focus.y)}/></label><label className="field"><span className="field-label">垂直焦点 · {focus.y}%</span><input type="range" min="0" max="100" value={focus.y} disabled={busy||draft.background==='plain'} onChange={event=>updateFocus(focus.x,Number(event.target.value))}/></label></div>
        <label className="field"><span className="field-label">背景遮罩 · {draft.shade}%</span><input type="range" min="0" max="70" value={draft.shade} disabled={busy||draft.background==='plain'} onChange={event=>change({shade:Number(event.target.value)})}/></label>
        <label className="field"><span className="field-label">电脑欢迎面板位置</span><select className="select" value={draft.position} disabled={busy} onChange={event=>change({position:event.target.value as WelcomeOptions['position']})}><option value="left">靠左</option><option value="center">居中</option><option value="right">靠右</option></select></label>
      </section>
      {(error||message)&&<p className="feedback" data-tone={error?'error':undefined} role={error?'alert':'status'}>{error||message}</p>}
      <div className="settings-form-actions"><button className="btn btn-primary" disabled={busy} onClick={()=>void save()}>{busy?'处理中…':'保存欢迎页'}</button><button className="btn btn-ghost" disabled={busy} onClick={()=>{++serial.current;setDraft(state.welcome);setImage(undefined);setError('');setMessage('');}}>取消修改</button><button className="btn btn-ghost" disabled={busy} onClick={()=>{setDraft(defaultWelcome());setImage(undefined);setMessage('已恢复默认预览，保存后生效。');}}><ArrowCounterClockwiseIcon size={17}/>恢复默认</button>{error&&<button className="btn btn-ghost" disabled={busy} onClick={()=>void read()}>重读当前设置</button>}</div>
      <details className="settings-details"><summary>备份与恢复欢迎页</summary><p className="muted">单独备份欢迎图和构图设置，不包含访问码与验证方式。导入后先预览，再保存。</p><div className="settings-form-actions"><a className="btn btn-secondary" href="/api/settings/welcome/export" download="slowtune-welcome.json">导出欢迎页</a><label className="btn btn-secondary welcome-import"><UploadSimpleIcon size={18}/>导入欢迎页<input type="file" accept="application/json,.json" aria-label="导入欢迎页备份" disabled={busy} onChange={async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;try{if(file.size>4*1024*1024+16384)throw new Error();const value=JSON.parse(await file.text());if(value.format!=='slowtune-welcome'||value.version!==1||!value.welcome||value.image!==undefined&&(typeof value.image!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(value.image)))throw new Error();const candidate=value.welcome as WelcomeOptions;if(!['builtin','custom','plain'].includes(candidate.background)||!['left','center','right'].includes(candidate.position)||![candidate.desktopFocus?.x,candidate.desktopFocus?.y,candidate.mobileFocus?.x,candidate.mobileFocus?.y].every(n=>Number.isFinite(n)&&n>=0&&n<=100)||!Number.isFinite(candidate.shade)||candidate.shade<0||candidate.shade>70||candidate.background==='custom'&&!value.image)throw new Error();setDraft({...candidate,imageId:undefined});setImage(value.image);setError('');setMessage('备份已载入预览，保存后生效。');}catch{setError('欢迎页备份格式不正确或文件过大，请重新选择。');}}}/></label></div></details>
    </>}
  </div>;
}
import { cacheDesktopWelcome } from './EntryGate';
