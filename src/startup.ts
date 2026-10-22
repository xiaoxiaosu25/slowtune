import { request, type ServerStatus } from './api';

export function bilibiliDiscoveryPath(refresh=false,desktop=typeof window!=='undefined'&&window.matchMedia?.('(min-width:761px)').matches) {
  return '/api/discovery/bilibili?refresh='+(refresh?'1':'0')+(desktop?'&surface=desktop':'');
}

/** One startup owns these requests. Workspace consumes the same promises once. */
export class StartupPreload {
  private pending = new Map<string, Promise<unknown>>();
  private controller = new AbortController();
  constructor() {
    for (const path of ['/api/status','/api/song-library','/api/bilibili/account','/api/follows',bilibiliDiscoveryPath()]) {
      const promise=request(path,undefined,AbortSignal.any([this.controller.signal,AbortSignal.timeout(path.includes('discovery')?45000:10000)]));
      this.pending.set(path,promise);
      void promise.catch(()=>{});
    }
  }
  async ready() { await (this.pending.get('/api/status') as Promise<ServerStatus>); }
  async take<T>(path:string,signal?:AbortSignal):Promise<T> {
    const promise=this.pending.get(path);
    if(!promise)return request<T>(path,undefined,signal);
    this.pending.delete(path);
    if(!signal)return promise as Promise<T>;
    signal.throwIfAborted();
    return new Promise<T>((resolve,reject)=>{
      const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
      void promise.then(value=>{if(!signal.aborted)resolve(value as T);},reject).finally(()=>signal.removeEventListener('abort',abort));
    });
  }
  dispose(){this.controller.abort();this.pending.clear();}
}
