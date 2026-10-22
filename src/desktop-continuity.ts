/** Desktop queue bookkeeping. Preserve live/preparing records until their owner releases them. */
export function prunePlaybackRecords<T>(state:{tracks:Map<string,T>;aliases:Map<string,string>;committed:Map<string,unknown>},ids:Iterable<string>,resources:Iterable<string>){
  const keepIds=new Set(ids),keepResources=new Set(resources);
  for(const id of keepIds)for(const prefix of ['queue:','song:','chart:'])keepResources.add(prefix+id);
  for(const id of state.tracks.keys())if(!keepIds.has(id))state.tracks.delete(id);
  for(const map of [state.aliases,state.committed])for(const id of map.keys())if(!keepResources.has(id))map.delete(id);
}

/** One short-lived raw preparation, never a player plan or media lease. */
export class DesktopNextPrefetch<T> {
  private job?:{id:string;key:string;controller:AbortController;value?:T;until:number;timer?:ReturnType<typeof setTimeout>};
  private attempted='';
  constructor(private release:(value:T)=>void,private now=Date.now){}
  start(id:string,key:string,prepare:(signal:AbortSignal)=>Promise<T>){
    if(this.job?.key===key||this.attempted===key)return;
    this.cancel();this.attempted=key;
    const job={id,key,controller:new AbortController(),until:0} as NonNullable<DesktopNextPrefetch<T>['job']>;this.job=job;
    job.timer=setTimeout(()=>this.cancel(),6000);
    void Promise.resolve().then(()=>{job.controller.signal.throwIfAborted();return prepare(job.controller.signal);}).then(value=>{
      if(this.job!==job||job.controller.signal.aborted){this.release(value);return;}
      clearTimeout(job.timer);job.value=value;job.until=this.now()+10000;job.timer=setTimeout(()=>this.cancel(),10000);
    }).catch(()=>{if(this.job===job)this.cancel();});
  }
  take(id:string,accept:(value:T)=>boolean=()=>true):T|undefined{
    const job=this.job;if(!job||job.id!==id)return;
    if(job.value===undefined||job.until<=this.now()||!accept(job.value)){this.cancel();return;}
    this.job=undefined;clearTimeout(job.timer);return job.value;
  }
  retain(ids:Iterable<string>){if(this.job&&!new Set(ids).has(this.job.id))this.cancel();}
  foreground(){if(this.job?.value===undefined)this.cancel();}
  cancel(){const job=this.job;this.job=undefined;if(!job)return;clearTimeout(job.timer);job.controller.abort();if(job.value!==undefined)this.release(job.value);}
  reset(){this.cancel();this.attempted='';}
  get size(){return this.job?1:0;}
}
