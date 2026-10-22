import { accessSync, constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MusicSources, MusicSourceError, type MusicHost } from '@studio/music-sources';
import { YoutubeProvider } from '@studio/music-sources/youtube';
import { YtDlpResolver } from '@studio/music-sources/node';
import type { Config } from './config.js';
import type { YoutubeStatus } from './source-settings-types.js';

/** Each enable cycle owns its API, tool and signal; disabling cannot revive old work. */
export class YoutubeRuntime {
  api?: MusicSources;
  tool?: YtDlpResolver;
  private desktopTool?:YtDlpResolver;
  private cycle = new AbortController();
  private generation = 0;
  private pending = new Set<Promise<unknown>>();
  private state: YoutubeStatus = { enabled: false, available: false, checking: false, issue: 'YouTube 已关闭' };
  constructor(private config: Config['ytDlp'], private host: MusicHost, private changed: () => void,private desktop=()=>false) {}
  get signal() { return this.cycle.signal; }
  get currentGeneration() { return this.generation; }
  status() { return { ...this.state }; }
  diagnostics(){return {active:(this.tool?.diagnostics().active??0)+(this.desktopTool?.diagnostics().active??0),disposed:this.cycle.signal.aborted};}
  assertEnabled() { if (!this.state.enabled) throw new MusicSourceError({code:'unsupported',provider:'youtube',upstreamCode:'source-disabled',retryable:false}); }
  assertAvailable() { this.assertEnabled(); if (!this.api) throw new MusicSourceError({code:this.state.checking?'busy':'unsupported',provider:'youtube',retryable:this.state.checking}); }
  private track(work: Promise<unknown>) { this.pending.add(work); void work.finally(()=>this.pending.delete(work)).catch(()=>{}); }
  setEnabled(enabled: boolean, retry = false) {
    if (this.state.enabled === enabled && !retry) return;
    const generation = ++this.generation;
    this.cycle.abort(); this.cycle = new AbortController();
    const oldApi = this.api, oldTool = this.tool,oldDesktopTool=this.desktopTool; this.api = undefined; this.tool = undefined;this.desktopTool=undefined;
    this.track(Promise.allSettled([oldApi?.dispose(),oldTool?.dispose(),oldDesktopTool?.dispose()]));
    this.state = { enabled, available: false, checking: enabled, issue: enabled ? undefined : 'YouTube 已关闭' }; this.changed();
    if (enabled) this.track(this.initialize(generation,this.cycle.signal));
  }
  private async initialize(generation: number, signal: AbortSignal) {
    try {
      if (!this.config) throw new Error('未配置工具');
      accessSync(this.config.executable,constants.X_OK); accessSync(this.config.nodeRuntime,constants.X_OK);
      const result = await promisify(execFile)(this.config.executable,[...(this.config.prefixArgs??[]),'--version'],{signal,timeout:15000,windowsHide:true,maxBuffer:65536});
      if (generation !== this.generation || signal.aborted) return;
      this.tool = new YtDlpResolver({...this.config,timeoutMs:45000});
      this.desktopTool=new YtDlpResolver({...this.config,timeoutMs:45000,reuseMs:5000});
      const legacy=this.tool,desktopTool=this.desktopTool;
      const port=new Proxy(legacy,{get:(_target,key)=>{
        if(key==='dispose')return ()=>Promise.allSettled([legacy.dispose(),desktopTool.dispose()]).then(()=>{});
        const target=this.desktop()&&['formats','resolve'].includes(String(key))?desktopTool:legacy,value=Reflect.get(target,key);
        if(typeof value!=='function')return value;
        return (...args:unknown[])=>{if(['formats','resolve'].includes(String(key))&&legacy.diagnostics().active+desktopTool.diagnostics().active>=2)throw new MusicSourceError({code:'busy',provider:'youtube',retryable:true});return value.apply(target,args);};
      }});
      this.api = new MusicSources(this.host,{youtube:new YoutubeProvider({resolver:'yt-dlp',tool:port})},60000);
      this.state = { enabled: true, available: true, checking: false, toolVersion: result.stdout.trim() };
    } catch {
      if (generation !== this.generation || signal.aborted) return;
      this.state = { enabled: true, available: false, checking: false, issue: '取源工具未配置、不可执行或检查失败。请检查配置后重新检查。' };
    }
    this.changed();
  }
  async dispose() { this.setEnabled(false); await Promise.allSettled([...this.pending]); }
}
