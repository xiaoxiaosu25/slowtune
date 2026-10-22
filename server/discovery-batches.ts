import { randomUUID } from 'node:crypto';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import type { MusicEntry, Shelf } from '@studio/music-sources';
import type { BrowseCache } from './browse-cache.js';
import type { MusicRecommendations, RecommendedShelf } from './recommendation.js';
import type { YoutubeMusicResult } from './youtube-regions.js';

export const desktopBilibiliBatchKey = 'bilibili:desktop';
export const isBilibiliBatch = (key:string) => key==='bilibili' || key===desktopBilibiliBatchKey;

export interface CandidateBatch { shelf: Shelf; extra?: Omit<YoutubeMusicResult,'shelf'> }
interface Snapshot extends CandidateBatch { signature: string; batchId: string; fetchedAt: number; selected: RecommendedShelf }
interface WarmBatch { signature: string; snapshot?: Snapshot; pending: boolean; issue?: string; work: Promise<Snapshot> }
interface Dependencies {
  cache: BrowseCache; recommendations: MusicRecommendations;
  signature: (key: string) => string;
  column: (key: string) => string;
  context: (key: string) => string;
  load: (key: string, options: {scope:string; parentScope?:string; signal:AbortSignal; seen:string[]; enough:(items:MusicEntry[])=>boolean; filled:(items:MusicEntry[])=>boolean}) => Promise<CandidateBatch>;
  now?: () => number;
}

function waitFor<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve,reject) => {
    const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason);};
    signal.addEventListener('abort',abort,{once:true});
    work.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}
const entryKey=(item:MusicEntry)=>JSON.stringify([item.ref.provider,item.ref.id,null]);

/** Startup snapshots are shared; explicit next batches belong to the requesting browser. */
export class DiscoveryBatches {
  private baseline=new Map<string,WarmBatch>();
  private browsers=new Map<string,Snapshot>();
  private operations=new Map<string,{controller:AbortController;work:Promise<Snapshot>}>();
  private stop=new AbortController();
  private startupWork?:Promise<void>;
  private startupActive=0;
  constructor(private dependencies:Dependencies) {}
  private get now(){return this.dependencies.now??Date.now;}
  private saved(key:string,signature:string):Snapshot|undefined{
    const value=this.dependencies.cache.read<Snapshot>('recommendation',JSON.stringify([key,signature]));
    if(!value||value.signature!==signature||value.selected?.id!==this.dependencies.column(key)||!Array.isArray(value.shelf?.page?.items)||!Array.isArray(value.selected?.page?.items)||value.selected.page.items.length>12||!value.selected.recommendation||!Number.isFinite(value.fetchedAt))return;
    return value;
  }
  async warm(key:string):Promise<Snapshot>{
    const signature=this.dependencies.signature(key),existing=this.baseline.get(key);
    if(existing?.signature===signature)return existing.work;
    const previous=this.saved(key,signature);
    const state:WarmBatch={signature,snapshot:previous,pending:true,work:undefined!};
    this.baseline.set(key,state);
    state.work=this.generate(key,'startup',this.stop.signal,previous).then(snapshot=>{
      state.snapshot=snapshot;state.issue=undefined;return snapshot;
    }).catch(error=>{
      state.issue=String((error as {code?:string}).code??'network');
      if(state.snapshot&&this.dependencies.signature(key)===signature)return state.snapshot;
      throw error;
    }).finally(()=>{state.pending=false;});
    // Background failure is reported on authenticated reads, never as an unhandled rejection.
    void state.work.catch(()=>{});
    return state.work;
  }
  start(jobs:(()=>Promise<unknown>)[]){
    if(this.startupWork)return;
    let index=0;
    const worker=async()=>{while(index<jobs.length&&!this.stop.signal.aborted){const job=jobs[index++];this.startupActive++;try{await job();}catch{/* Each source retains its own last successful snapshot. */}finally{this.startupActive--;}}};
    this.startupWork=Promise.all([worker(),worker(),worker()]).then(()=>{});
  }
  get signal(){return this.stop.signal;}
  private async generate(key:string,owner:string,signal:AbortSignal,previous?:Snapshot):Promise<Snapshot>{
    const signature=this.dependencies.signature(key),column=this.dependencies.column(key),context=this.dependencies.context(key),scope='batch:'+randomUUID(),seed=randomUUID();
    const combined=AbortSignal.any([signal,this.stop.signal,AbortSignal.timeout(isBilibiliBatch(key)?60000:45000)]);
    const recent=this.dependencies.recommendations.seen(owner,column,context).map(id=>JSON.stringify([isBilibiliBatch(key)?'bilibili':'youtube',id,null]));
    const sample=(items:MusicEntry[])=>this.dependencies.recommendations.sample(scope,{id:column,title:column,kind:'recommendation',page:{items}},seed,context,combined,recent);
    const enough=(items:MusicEntry[])=>sample(items).page!.items.filter(item=>!recent.includes(entryKey(item))).length>=12;
    const filled=(items:MusicEntry[])=>sample([...items,...(previous?.signature===signature?previous.shelf.page?.items??[]:[])]).page!.items.length>=12;
    try {
      const batch=await this.dependencies.load(key,{scope:JSON.stringify([owner,key,signature]),parentScope:owner==='startup'?undefined:JSON.stringify(['startup',key,signature]),signal:combined,seen:recent.map(id=>String(JSON.parse(id)[1])),enough,filled});
      combined.throwIfAborted();
      if(batch.shelf.error||!batch.shelf.page)throw Object.assign(new Error('Candidate source failed'),{code:batch.shelf.error?.code??'upstream'});
      const merged=new Map<string,MusicEntry>();
      for(const item of [...batch.shelf.page.items,...(previous?.signature===signature?previous.shelf.page?.items??[]:[])])if(!merged.has(entryKey(item)))merged.set(entryKey(item),item);
      const shelf={...batch.shelf,page:{...batch.shelf.page,items:[...merged.values()].slice(0,256)}};
      const selected=this.dependencies.recommendations.sample(scope,shelf,seed,context,combined,recent),batchId=randomUUID(),fetchedAt=this.now();
      selected.recommendation={...selected.recommendation!,batchId,fetchedAt,target:12};
      const issue=(batch.shelf as Shelf&{candidateIssue?:string}).candidateIssue;
      if(issue)selected.recommendation.issue=issue;
      if(selected.page!.items.length<12&&!selected.recommendation.shortage.includes('insufficient-eligible'))selected.recommendation.shortage.push('insufficient-eligible');
      if(this.dependencies.signature(key)!==signature)throw new LibraryError('conflict');
      combined.throwIfAborted();
      const snapshot={...batch,shelf,signature,batchId,fetchedAt,selected};
      // A zero-result response cannot erase a previously useful compatible batch.
      if(!selected.page!.items.length&&previous?.selected.page?.items.length)return {...previous,selected:{...previous.selected,recommendation:{...previous.selected.recommendation!,issue:'no-results',retained:true}}};
      this.dependencies.cache.write('recommendation',JSON.stringify([key,signature]),snapshot,16);
      return snapshot;
    } finally {this.dependencies.recommendations.invalidate(scope);}
  }
  async read(key:string,owner:string,signal:AbortSignal,refresh=false):Promise<CandidateBatch>{
    const signature=this.dependencies.signature(key),browserKey=owner+'\n'+key;
    let snapshot=this.browsers.get(browserKey);
    if(snapshot?.signature!==signature){this.browsers.delete(browserKey);snapshot=undefined;}
    if(refresh){
      this.operations.get(browserKey)?.controller.abort();
      const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal,this.stop.signal]);
      const baseline=this.baseline.get(key),previous=snapshot??(baseline?.signature===signature?baseline.snapshot:this.saved(key,signature));
      const operation={controller,work:undefined! as Promise<Snapshot>};this.operations.set(browserKey,operation);
      operation.work=this.generate(key,owner,combined,previous);
      try {
        snapshot=await operation.work;
        if(this.operations.get(browserKey)!==operation)throw new LibraryError('conflict');
        combined.throwIfAborted();this.browsers.set(browserKey,snapshot);
      }catch(error){
        if(combined.aborted||this.dependencies.signature(key)!==signature||!previous)throw error;
        snapshot={...previous,selected:{...previous.selected,recommendation:{...previous.selected.recommendation!,issue:String((error as {code?:string}).code??'network'),retained:true}}};
        this.browsers.set(browserKey,snapshot);
      }finally{if(this.operations.get(browserKey)===operation)this.operations.delete(browserKey);}
    }else if(!snapshot){
      void this.warm(key).catch(()=>{});
      const baseline=this.baseline.get(key)!;
      snapshot=baseline.snapshot??await waitFor(baseline.work,signal);
    }
    signal.throwIfAborted();
    if(this.dependencies.signature(key)!==signature)throw new LibraryError('conflict');
    const baseline=this.baseline.get(key),updating=!refresh&&!this.browsers.has(browserKey)&&baseline?.pending===true;
    const warmIssue=!this.browsers.has(browserKey)?baseline?.issue:undefined;
    const selected={...snapshot.selected,recommendation:{...snapshot.selected.recommendation!,updating,issue:snapshot.selected.recommendation?.issue??warmIssue,retained:snapshot.selected.recommendation?.retained??!!warmIssue}};
    const shelf=this.dependencies.recommendations.bind(owner,selected,snapshot.shelf,this.dependencies.context(key),selected.recommendation.seed);
    return {shelf,extra:snapshot.extra};
  }
  cancelOwner(owner:string,forget=true){
    for(const [key,operation]of this.operations)if(key.startsWith(owner+'\n'))operation.controller.abort();
    if(forget)for(const key of this.browsers.keys())if(key.startsWith(owner+'\n'))this.browsers.delete(key);
  }
  cancelProvider(prefix:string){
    for(const [key,operation]of this.operations)if(key.split('\n').at(-1)?.startsWith(prefix))operation.controller.abort();
    for(const key of this.browsers.keys())if(key.split('\n').at(-1)?.startsWith(prefix))this.browsers.delete(key);
    for(const key of this.baseline.keys())if(key.startsWith(prefix))this.baseline.delete(key);
  }
  diagnostics(){return {startupActive:this.startupActive,warming:[...this.baseline.values()].filter(value=>value.pending).length,browsers:this.browsers.size,active:this.operations.size};}
  async dispose(){this.stop.abort();for(const operation of this.operations.values())operation.controller.abort();await Promise.allSettled([...(this.startupWork?[this.startupWork]:[]),...[...this.baseline.values()].map(value=>value.work),...[...this.operations.values()].map(value=>value.work)]);this.baseline.clear();this.browsers.clear();}
}
