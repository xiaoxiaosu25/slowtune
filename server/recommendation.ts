import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CONFIG, execute, identityKey, resolveSettings, validateSettings, RecommendationError, type Candidate, type SettingsDocument, type ConfigOverrides } from '@studio/recommendation';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import type { MusicEntry, Shelf } from '@studio/music-sources';

export const columns=['music-recommendation','account-recommendation','hot-chart','new-music','youtube-music-selection'] as const;
export type Column=typeof columns[number];
export type LegacyRules={include:string[];exclude:string[];mode:'any'|'all';order:'upstream'|'random'};
export interface SelectionState {entry:0|1;epoch:number;legacyRevision:string;sharedRevision:string;legacy:LegacyRules;document:SettingsDocument;origins:Record<string,string>}
export interface RecommendationInfo {entry:0|1;order:string;processed:boolean;token?:string;shortage:string[];diagnostics?:unknown;reasons?:{id:string;reasons:string[]}[];pool:number;seed:string;context:string;batchId?:string;fetchedAt?:number;target?:number;updating?:boolean;issue?:string;retained?:boolean}
export type RecommendedShelf=Shelf&{recommendation?:RecommendationInfo};
const legacyDefault:LegacyRules={include:[],exclude:[],mode:'any',order:'upstream'};
export function preset(column:Column):SettingsDocument{
 const config=structuredClone(DEFAULT_CONFIG);config.algorithm='literal-case-v1';config.batchSize=500;config.repeat='after-fresh';
 config.scope.sources=[column==='youtube-music-selection'?'youtube':'bilibili'];config.scope.media=['video'];
 return {schema:1,revision:'shared-0',preset:{id:'slow-listening:'+column,revision:'music-v1',config},overrides:{}};
}
function column(value:string):Column{if(!columns.includes(value as Column))throw new LibraryError('invalid-input');return value as Column;}
function legacy(value:any):LegacyRules{
 if(!value||Object.keys(value).some(k=>!['include','exclude','mode','order'].includes(k))||!['any','all'].includes(value.mode)||!['upstream','random'].includes(value.order))throw new LibraryError('invalid-input');
 for(const list of [value.include,value.exclude])if(!Array.isArray(list)||list.length>24||list.some((v:any)=>typeof v!=='string'||!v.trim()||v.length>120))throw new LibraryError('invalid-input');
 return structuredClone(value);
}
export function translateLegacy(value:LegacyRules):ConfigOverrides{
 const fields=['title'] as const,include=[...new Set(value.include)],exclude=[...new Set(value.exclude)];
 return {include:{mode:value.mode,groups:include.length?[{id:'legacy-include',fields:[...fields],mode:value.mode,terms:include}]:[]},exclude:exclude.length?[{id:'legacy-exclude',fields:[...fields],mode:'any',terms:exclude}]:[],order:value.order};
}
const legacyControlText=(text:string)=>/[\u0000-\u001f]/.test(text);
// Frozen legacy rules accept literal control characters that shared documents reject.
// Only that compatibility case filters here; public execution still owns ordering/history.
function matchesLegacyTitle(title:string,rules:LegacyRules){
 const text=title.toLocaleLowerCase(),matches=(term:string)=>text.includes(term.toLocaleLowerCase());
 return !rules.exclude.some(matches)&&(!rules.include.length||(rules.mode==='all'?rules.include.every(matches):rules.include.some(matches)));
}
export function projectMusic(entry:MusicEntry,shelf:string,parts=false):Candidate{
 return {identity:{namespace:entry.ref.provider,id:entry.ref.id,...(parts&&entry.ref.part?{part:entry.ref.part}:{})},source:entry.ref.provider,authorized:true,available:true,media:'video',title:entry.title,
 ...(entry.uploader?.name?{author:entry.uploader.name,...(entry.uploader.id?{authorId:entry.uploader.id}:{})}:entry.artists?.length?{author:entry.artists.join(' / ')}:{}),
 ...(entry.tags?{tags:entry.tags}:{}),...(entry.categories?{categories:entry.categories}:{}),...(entry.board?{board:entry.board}:{}),...(entry.publishedAt!==undefined?{timestamp:entry.publishedAt}:{}),
 directoryId:entry.ref.provider+':'+entry.ref.id,provenance:shelf};
}
export class RecommendationStore{
 private db:DatabaseSync;
 constructor(path:string,private user:string){this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS recommendation_state(user TEXT,column_id TEXT,entry INTEGER,epoch INTEGER,legacy_revision TEXT,shared_revision TEXT,PRIMARY KEY(user,column_id)); CREATE TABLE IF NOT EXISTS recommendation_revision(user TEXT,column_id TEXT,format INTEGER,revision TEXT,value TEXT,PRIMARY KEY(user,column_id,format,revision));');}
 read(id:string):SelectionState{
  const key=column(id);this.db.prepare('INSERT OR IGNORE INTO recommendation_state VALUES(?,?,1,0,?,?)').run(this.user,key,'legacy-0','shared-0');
  this.db.prepare('INSERT OR IGNORE INTO recommendation_revision VALUES(?,?,?,?,?)').run(this.user,key,0,'legacy-0',JSON.stringify(legacyDefault));this.db.prepare('INSERT OR IGNORE INTO recommendation_revision VALUES(?,?,?,?,?)').run(this.user,key,1,'shared-0',JSON.stringify(preset(key)));
  const row=this.db.prepare('SELECT * FROM recommendation_state WHERE user=? AND column_id=?').get(this.user,key)!;
  const load=(format:number,revision:any)=>JSON.parse(String(this.db.prepare('SELECT value FROM recommendation_revision WHERE user=? AND column_id=? AND format=? AND revision=?').get(this.user,key,format,revision)!.value));
  const document=validateSettings(load(1,row.shared_revision));const origins=resolveSettings(document).origins;
  return {entry:Number(row.entry) as 0|1,epoch:Number(row.epoch),legacyRevision:String(row.legacy_revision),sharedRevision:String(row.shared_revision),legacy:legacy(load(0,row.legacy_revision)),document,origins};
 }
 update(id:string,expected:SelectionState,input:{entry?:0|1;overrides?:ConfigOverrides;legacy?:LegacyRules;absorbLegacy?:boolean},signal:AbortSignal){
  signal.throwIfAborted();const key=column(id);this.db.exec('BEGIN IMMEDIATE');
  try{const current=this.read(key);
   if(!expected||['entry','epoch','legacyRevision','sharedRevision'].some(k=>current[k as keyof SelectionState]!==expected[k as keyof SelectionState]))throw new LibraryError('conflict',current.sharedRevision);
   if(input.entry!==undefined&&input.entry!==0&&input.entry!==1)throw new LibraryError('invalid-input');
   let legacyRevision=current.legacyRevision,sharedRevision=current.sharedRevision;
   if(input.legacy!==undefined){legacyRevision=randomUUID();this.db.prepare('INSERT INTO recommendation_revision VALUES(?,?,?,?,?)').run(this.user,key,0,legacyRevision,JSON.stringify(legacy(input.legacy)));}
   if(input.overrides!==undefined){const document=validateSettings({...preset(key),revision:randomUUID(),overrides:input.overrides});const config=resolveSettings(document).config;
    if(config.scope.unheard||config.scope.roots.length||config.scope.live!==undefined||config.scope.sources.some(s=>!preset(key).preset.config.scope.sources.includes(s))||config.scope.media.some(m=>m!=='video')||config.batchSize!==500)throw new LibraryError('invalid-input');
    if(input.absorbLegacy&&JSON.stringify(input.overrides)!==JSON.stringify(translateLegacy(current.legacy)))throw new LibraryError('invalid-input');
    sharedRevision=document.revision;this.db.prepare('INSERT INTO recommendation_revision VALUES(?,?,?,?,?)').run(this.user,key,1,sharedRevision,JSON.stringify(document));
   }
   signal.throwIfAborted();this.db.prepare('UPDATE recommendation_state SET entry=?,epoch=?,legacy_revision=?,shared_revision=? WHERE user=? AND column_id=?').run(input.entry??current.entry,current.epoch+1,legacyRevision,sharedRevision,this.user,key);this.db.exec('COMMIT');return this.read(key);
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 close(){this.db.close();}
}
interface Pending {token:string;scope:string;id:string;context:string;keys:string[];confirmed:Set<string>;state:SelectionState;cleanup:()=>void;batchId?:string}
export class MusicRecommendations{
 private pending=new Map<string,Pending>();private recent=new Map<string,string[]>();private requests=new Map<string,number>();
 private pools=new Map<string,{shelf:Shelf;context:string;auth:string;seed:string}>();
 private previews=new Map<string,{state:SelectionState;overrides:string;auth:string;context:string;absorbLegacy:boolean}>();
 private sequence=0;
 private contexts=new Map<string,string>();
 private measured={coreMs:0,retainedBytes:0,candidates:0};
 constructor(readonly store:RecommendationStore,private authorization:()=>string){}
 remember(scope:string,shelf:Shelf,context:string,seed:string){if(!shelf.page||shelf.error)return;this.pools.set(scope+'\n'+shelf.id,{shelf:structuredClone(shelf),context,auth:this.authorization(),seed});while(this.pools.size>256)this.pools.delete(this.pools.keys().next().value!);}
 preview(scope:string,id:string,overrides:ConfigOverrides,signal:AbortSignal,absorbLegacy=false){const key=scope+'\n'+id,pool=this.pools.get(key);if(!pool||pool.auth!==this.authorization())throw new LibraryError('not-found');const state=this.store.read(id);if(absorbLegacy&&JSON.stringify(overrides)!==JSON.stringify(translateLegacy(state.legacy)))throw new LibraryError('invalid-input');const result=this.select(scope,pool.shelf,this.begin(scope,id),pool.seed,pool.context,signal,'preview',overrides);this.previews.set(key,{state,overrides:JSON.stringify(overrides),auth:pool.auth,context:pool.context,absorbLegacy});return result;}
 save(scope:string,id:string,expected:SelectionState,patch:Parameters<RecommendationStore['update']>[2],signal:AbortSignal){
  const key=scope+'\n'+id,proof=this.previews.get(key),pool=this.pools.get(key),current=this.store.read(id);
  if(!expected||['entry','epoch','legacyRevision','sharedRevision'].some(k=>current[k as keyof SelectionState]!==expected[k as keyof SelectionState]))throw new LibraryError('conflict',current.sharedRevision);
  if(patch.overrides!==undefined&&(!proof||!pool||proof.auth!==this.authorization()||pool.auth!==proof.auth||pool.context!==proof.context||proof.overrides!==JSON.stringify(patch.overrides)||proof.absorbLegacy!==!!patch.absorbLegacy||['entry','epoch','legacyRevision','sharedRevision'].some(k=>proof.state[k as keyof SelectionState]!==current[k as keyof SelectionState])))throw new LibraryError('conflict',current.sharedRevision);
  const saved=this.store.update(id,expected,patch,signal);this.previews.delete(key);return saved;
 }
 seen(scope:string,id:string,context:string){const s=this.store.read(id);return (this.recent.get(JSON.stringify([scope,id,this.authorization(),s.epoch,context]))??[]).map(k=>String(JSON.parse(k)[1]));}
 invalidate(scope?:string,id?:string){for(const [key,value]of this.pending)if((!scope||value.scope===scope)&&(!id||value.id===id)){value.cleanup();this.pending.delete(key);}for(const map of [this.requests,this.pools,this.contexts,this.previews])for(const key of map.keys())if((!scope||key.startsWith(scope+'\n'))&&(!id||key.endsWith('\n'+id)))map.delete(key);}
 begin(scope:string,id:string,context?:string){column(id);const key=scope+'\n'+id;this.previews.delete(key);if(context!==undefined&&this.contexts.get(key)!==context){this.pools.delete(key);this.contexts.set(key,context);}this.pending.get(key)?.cleanup();this.pending.delete(key);const serial=++this.sequence;this.requests.set(key,serial);while(this.requests.size>320){const oldest=this.requests.keys().next().value!;this.requests.delete(oldest);this.pending.get(oldest)?.cleanup();this.pending.delete(oldest);this.contexts.delete(oldest);this.pools.delete(oldest);this.previews.delete(oldest);}return {key,serial,auth:this.authorization(),state:this.store.read(id)};}
 select(scope:string,shelf:Shelf,input:ReturnType<MusicRecommendations['begin']>,seed:string,context:string,signal:AbortSignal,mode:'display'|'preview'='display',overrides?:ConfigOverrides,fixed=false,recent?:string[]):RecommendedShelf{
  const started=performance.now();signal.throwIfAborted();const state=this.store.read(shelf.id);
  if(this.requests.get(input.key)!==input.serial||this.authorization()!==input.auth||state.epoch!==input.state.epoch)throw new LibraryError('conflict',state.sharedRevision);
  if(shelf.error||!shelf.page)return shelf;
  const source=shelf.id==='youtube-music-selection'?'youtube':'bilibili',access={user:scope,authorizationRevision:input.auth,sourceRevision:context,grants:[{source}]};
  const compatibleLegacy=state.entry===0&&!overrides&&[...state.legacy.include,...state.legacy.exclude].some(legacyControlText);
  const document=state.entry===0?{...preset(column(shelf.id)),overrides:compatibleLegacy?{order:state.legacy.order}:translateLegacy(state.legacy)}:state.document;
  const {config}=resolveSettings({...document,...(overrides?{overrides}:{})});
  const original=!overrides&&state.entry===0&&!state.legacy.include.length&&!state.legacy.exclude.length&&state.legacy.order==='upstream';const candidates=shelf.page.items.map(t=>{const candidate=projectMusic(t,shelf.id);if(compatibleLegacy&&legacyControlText(t.title))delete candidate.title;return candidate;});
  const legacyIndexes=compatibleLegacy?shelf.page.items.flatMap((entry,index)=>matchesLegacyTitle(entry.title,state.legacy)?[index]:[]):undefined;
  const executionCandidates=legacyIndexes?legacyIndexes.map(index=>candidates[index]):candidates;
  const historyKey=JSON.stringify([scope,shelf.id,input.auth,state.epoch,context]);
  const history=recent??(shelf.kind==='recommendation'?(this.recent.get(historyKey)??[]):[]);
  const bounded=fixed||shelf.id==='account-recommendation';
  const request={candidates:executionCandidates,config:bounded?{...config,batchSize:12}:config,access,seed,recent:history,signal,all:!bounded};
  const result=execute(request);
  const entries=new Map<string,MusicEntry>();for(let i=0;i<executionCandidates.length;i++){const key=identityKey(executionCandidates[i].identity);if(!entries.has(key))entries.set(key,shelf.page.items[legacyIndexes?.[i]??i]);}
  const items=result.items.map(p=>entries.get(p.key)!);const token=randomUUID();
  this.measured={coreMs:performance.now()-started,retainedBytes:Buffer.byteLength(JSON.stringify({candidates,items})),candidates:candidates.length};
  if(this.measured.coreMs>5000||this.measured.retainedBytes>32*1024*1024)throw new RecommendationError('budget','complete request execution or retained bytes exceeded');
  if(mode==='display'){const aborted=()=>{if(this.pending.get(input.key)?.token===token){this.pending.delete(input.key);this.requests.delete(input.key);}signal.removeEventListener('abort',aborted);};signal.addEventListener('abort',aborted,{once:true});this.pending.set(input.key,{token,scope,id:shelf.id,context:historyKey,keys:result.items.map(i=>i.key),confirmed:new Set(),state,cleanup:()=>signal.removeEventListener('abort',aborted)});}
  const changed=result.items.length!==candidates.length||result.items.some((item,index)=>item.key!==identityKey(candidates[index].identity));
  const processed=changed||!original&&(!!overrides||Object.keys(state.document.overrides).length>0);
  return {...shelf,page:{...shelf.page,items},recommendation:{entry:state.entry,order:config.order,processed,...(mode==='display'?{token}:{}),shortage:result.shortage,diagnostics:result.diagnostics,reasons:result.items.map(i=>({id:i.key,reasons:i.reasons})),pool:candidates.length,seed,context}};
 }
 sample(scope:string,shelf:Shelf,seed:string,context:string,signal:AbortSignal,recent:string[]=[]){
  return this.select(scope,shelf,this.begin(scope,shelf.id,context),seed,context,signal,'preview',undefined,true,recent);
 }
 /** Bind a frozen batch without executing its order against newly confirmed history. */
 bind(scope:string,selected:RecommendedShelf,raw:Shelf,context:string,seed:string):RecommendedShelf{
  if(!selected.page||selected.error||!selected.recommendation)return structuredClone(selected);
  const previous=this.pending.get(scope+'\n'+selected.id),state=this.store.read(selected.id);
  if(selected.recommendation.batchId&&previous?.batchId===selected.recommendation.batchId&&previous.state.epoch===state.epoch&&JSON.parse(previous.context)[2]===this.authorization()){
    this.remember(scope,raw,context,seed);
    return {...structuredClone(selected),recommendation:{...selected.recommendation,token:previous.token}};
  }
  const input=this.begin(scope,selected.id,context),token=randomUUID(),keys=selected.page.items.map(item=>identityKey(projectMusic(item,selected.id).identity));
  this.pending.set(input.key,{token,scope,id:selected.id,context:JSON.stringify([scope,selected.id,input.auth,input.state.epoch,context]),keys,confirmed:new Set(),state:input.state,cleanup:()=>{},batchId:selected.recommendation.batchId});
  this.remember(scope,raw,context,seed);
  return {...structuredClone(selected),recommendation:{...selected.recommendation,token}};
 }
 confirm(scope:string,id:string,token:string,ids:string[]){const key=scope+'\n'+id,p=this.pending.get(key);if(!p||p.token!==token)return {accepted:false};const state=this.store.read(id);
  if(state.epoch!==p.state.epoch||!Array.isArray(ids)||ids.some(id=>!p.keys.includes(id)))return {accepted:false};
  // Auth is part of the pending history context; a changed account invalidates confirmation.
  if(JSON.parse(p.context)[2]!==this.authorization())return {accepted:false};
  // An acknowledged batch remains visible after its acquisition timeout. New requests,
  // configuration/auth changes and explicit invalidation still reject its token.
  p.cleanup();const selected=[...new Set(ids)].filter(id=>!p.confirmed.has(id));for(const id of selected)p.confirmed.add(id);
  if(selected.length)this.recent.set(p.context,[...(this.recent.get(p.context)??[]).filter(k=>!selected.includes(k)),...selected].slice(-100));
  while(this.recent.size>256)this.recent.delete(this.recent.keys().next().value!);return {accepted:true,count:selected.length};
 }
 diagnostics(){return {pending:this.pending.size,histories:this.recent.size,lastExecution:this.measured};}
}
