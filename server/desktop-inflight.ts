/** In-flight only: no settled values, one cancellation subscription per consumer. */
export class DesktopInflight {
  private jobs=new Map<string,{owner:string;controller:AbortController;users:number;promise:Promise<unknown>}>();
  run<T>(owner:string,key:string,signal:AbortSignal,task:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    signal.throwIfAborted();
    let job=this.jobs.get(key);
    if(!job){
      if(this.jobs.size>=64)return task(signal);
      const controller=new AbortController();
      job={owner,controller,users:0,promise:Promise.resolve().then(()=>{controller.signal.throwIfAborted();return task(controller.signal);})};
      this.jobs.set(key,job);
      const current=job;
      void job.promise.finally(()=>{if(this.jobs.get(key)===current)this.jobs.delete(key);}).catch(()=>{});
    }
    const current=job;current.users++;
    return new Promise<T>((resolve,reject)=>{
      let done=false;
      const finish=(failed:boolean,value:unknown)=>{
        if(done)return;done=true;signal.removeEventListener('abort',abort);current.users--;
        if(!current.users){if(this.jobs.get(key)===current)this.jobs.delete(key);current.controller.abort();}
        if(failed)reject(value);else resolve(value as T);
      };
      const abort=()=>finish(true,signal.reason??new DOMException('Cancelled','AbortError'));
      signal.addEventListener('abort',abort,{once:true});
      current.promise.then(value=>finish(false,value),error=>finish(true,error));
      if(signal.aborted)abort();
    });
  }
  cancelOwner(owner:string){for(const [key,job]of this.jobs)if(job.owner===owner){this.jobs.delete(key);job.controller.abort();}}
  has(key:string){return this.jobs.has(key);}
  get size(){return this.jobs.size;}
  dispose(){for(const job of this.jobs.values())job.controller.abort();this.jobs.clear();}
}

export function requestIdentity(value:unknown):string{
  return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
}
