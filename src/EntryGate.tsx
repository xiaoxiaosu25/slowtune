import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MusicClient } from '@studio/music-sources/client';
import { ArrowRightIcon, ArrowClockwiseIcon, EyeIcon, EyeSlashIcon, SpinnerGapIcon } from '@phosphor-icons/react';
import { defaultWelcome, type BootstrapState } from '../server/startup-types';
import { errorText, request } from './api';
import { refreshableClient } from './source-settings';
import { StartupPreload } from './startup';
import { WelcomeScreen } from './WelcomeScreen';
import { connectSourceClient } from './source-client';
import { DesktopStartup } from './DesktopStartup';

let welcomeCacheGeneration = 0;
export async function cacheDesktopWelcome(settings: BootstrapState['welcome']) {
  const desktop = window.slowTuneDesktop; if (!desktop) return;
  const generation = ++welcomeCacheGeneration;
  let image: string | undefined;
  if (settings.background === 'custom' && settings.imageId) {
    const response = await fetch('/api/welcome/image/' + encodeURIComponent(settings.imageId));
    if (!response.ok) return;
    const blob = await response.blob(); if (blob.size > 3 * 1024 * 1024) return;
    image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
  }
  if (generation === welcomeCacheGeneration) await desktop.saveWelcome({ settings, image });
}

export function EntryGate({children}:{children:(client:MusicClient,preload:StartupPreload,onLogout:()=>void)=>ReactNode}) {
  const [bootstrap,setBootstrap]=useState<BootstrapState>(),[mode,setMode]=useState<'checking'|'login'|'preparing'|'error'|'workspace'>('checking');
  const [code,setCode]=useState(''),[visible,setVisible]=useState(false),[error,setError]=useState(''),[slow,setSlow]=useState(false);
  const [bundle,setBundle]=useState<{client:MusicClient;preload:StartupPreload}>();
  const active=useRef<{controller:AbortController;client?:MusicClient;preload?:StartupPreload}|undefined>(undefined),serial=useRef(0);
  const start=useCallback(async(accessKey?:string)=>{
    const generation=++serial.current;active.current?.controller.abort();active.current?.preload?.dispose();active.current?.client?.dispose();
    const controller=new AbortController(),current={controller,client:undefined as MusicClient|undefined,preload:undefined as StartupPreload|undefined};active.current=current;
    setBundle(undefined);setMode('checking');setError('');setSlow(false);
    const started=Date.now(),timer=setTimeout(()=>{if(generation===serial.current)setSlow(true);},3000);
    try {
      const state=await request<BootstrapState>('/api/bootstrap',undefined,AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]));
      if(generation!==serial.current)return;setBootstrap(state);
      void cacheDesktopWelcome(state.welcome).catch(()=>{});
      if(accessKey!==undefined){
        try{await request('/api/login',{accessKey},controller.signal);}catch(issue){if((issue as {code?:string}).code==='authentication')throw new Error('invalid-login');throw issue;}
        setCode('');
      }else if(!state.authenticated){
        const restored=await window.slowTuneDesktop?.restoreLocalSession?.();
        if(!restored){
          if(window.slowTuneDesktop) throw new Error('本地访问尚未准备完成，请重试打开慢听。');
          if(state.authenticationRequired){setMode('login');return;}
          await request('/api/session',{},controller.signal);
        }
      }
      setMode('preparing');current.preload=new StartupPreload();
      const connectClient=()=>connectSourceClient(location.origin,controller.signal);
      const connecting=connectClient().then(client=>{if(controller.signal.aborted){client.dispose();throw controller.signal.reason;}current.client=refreshableClient(client,connectClient);});
      await Promise.all([current.preload.ready(),connecting]);
      const remaining=window.slowTuneDesktop?0:Math.max(0,1500-(Date.now()-started));
      if(remaining)await new Promise<void>(resolve=>{const wait=setTimeout(resolve,remaining);controller.signal.addEventListener('abort',()=>{clearTimeout(wait);resolve();},{once:true});});
      if(generation!==serial.current||controller.signal.aborted)return;
      setBundle({client:current.client!,preload:current.preload});setMode('workspace');
    }catch(issue){
      if(generation!==serial.current||controller.signal.aborted)return;
      controller.abort();
      current.preload?.dispose();current.client?.dispose();current.client=undefined;
      const invalid=(issue as Error).message==='invalid-login';
      setError(invalid?'访问码不正确，请重新输入。':(issue as Error).name==='TimeoutError'?(window.slowTuneDesktop?'本地音乐准备超时，请重试。':'连接服务超时，请检查服务后重试。'):errorText(issue));setMode(invalid?'login':'error');
    }finally{clearTimeout(timer);}
  },[]);
  useEffect(()=>{void start();const expired=()=>void start();window.addEventListener('slowtune:session-expired',expired);return()=>{++serial.current;active.current?.controller.abort();active.current?.preload?.dispose();active.current?.client?.dispose();window.removeEventListener('slowtune:session-expired',expired);};},[start]);
  useEffect(() => {
    if (mode === 'workspace' && window.slowTuneDesktop && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.getElementById('root')?.animate([{ opacity: .25 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
    }
  }, [mode]);
  if(mode==='workspace'&&bundle)return children(bundle.client,bundle.preload,()=>void start());
  if(window.slowTuneDesktop)return <DesktopStartup settings={bootstrap?.welcome??defaultWelcome()} message={mode==='error'?error:slow?'正在准备歌单与收藏…':'正在准备你的音乐…'} error={mode==='error'} onRetry={()=>void start()}/>;
  return <WelcomeScreen settings={bootstrap?.welcome??defaultWelcome()}>
    {mode==='login'?<form className="welcome-login" onSubmit={event=>{event.preventDefault();void start(code);}}>
      <label className="field"><span className="field-label">服务访问码</span><span className="welcome-password"><input className="input" aria-label="服务访问码" type={visible?'text':'password'} value={code} onChange={event=>setCode(event.target.value)} autoComplete="current-password" maxLength={256} required placeholder="输入访问码，进入你的音乐空间"/><button type="button" className="btn btn-icon" aria-label={visible?'隐藏访问码':'显示访问码'} onClick={()=>setVisible(value=>!value)}>{visible?<EyeSlashIcon size={19}/>:<EyeIcon size={19}/>}</button></span></label>
      {error&&<p className="feedback" data-tone="error" role="alert">{error}</p>}
      <button className="btn btn-primary welcome-enter" type="submit">进入音乐空间<ArrowRightIcon size={19}/></button>
      <details className="welcome-help"><summary>访问码是什么？</summary><p>这是此音乐服务的私人访问码。首次使用由服务配置提供，进入后可在「设置 → 启动与访问」中修改。B站账号在设置中单独登录。</p></details>
    </form>:mode==='error'?<div className="welcome-status"><p className="feedback" data-tone="error" role="alert">{error}</p><button className="btn btn-primary" onClick={()=>void start()}><ArrowClockwiseIcon size={19}/>{window.slowTuneDesktop?'重试':'重新连接'}</button>{window.slowTuneDesktop&&<><button className="btn btn-secondary" onClick={()=>void window.slowTuneDesktop?.openDirectory('logs')}>打开日志文件夹</button><button className="btn btn-ghost" onClick={()=>window.slowTuneDesktop?.quit()}>退出</button></>}</div>:<div className="welcome-status" role="status" aria-live="polite"><div className="welcome-loading"><SpinnerGapIcon size={22} className="welcome-spinner"/><span>{mode==='checking'&&!window.slowTuneDesktop?'正在连接音乐空间…':slow?'正在准备歌单与收藏…':'正在准备你的音乐…'}</span></div><p className="muted">{mode==='checking'&&slow&&!window.slowTuneDesktop?'服务响应较慢，请稍候。':'准备好后将自动进入'}</p></div>}
  </WelcomeScreen>;
}
