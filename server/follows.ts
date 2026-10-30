import { randomUUID } from 'node:crypto';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import { MusicSourceError, type MusicApi, type MusicEntry } from '@studio/music-sources';
import { FollowStore, validateCreator } from './follow-store.js';
import type { CreatorSources } from './creator-sources.js';
import { creatorKey, type CreatorRef, type CreatorProfile, type FollowFeed, type FollowedCreator } from './follow-types.js';
import { artworkUrl } from './artwork-url.js';
import type { CreatorSearchRequest } from '@studio/music-sources/creators';

type Sources = Pick<CreatorSources,'profile'|'videos'|'collections'|'collectionVideos'|'cancelOwner'> & Partial<Pick<CreatorSources,'dispose'|'search'>>;
// Stop batch reads before the 60-second request deadline so cached results can still be returned.
const batchReadTimeout=45000;
interface FeedSnapshot {owner:string;revision:string;provider?:string;items:MusicEntry[];warnings:FollowFeed['warnings'];fetchedAt:number;until:number}
export class Follows {
  private stop=new AbortController();
  private work=new Map<AbortController,{owner:string;promise:Promise<unknown>}>();
  private feeds=new Map<string,FeedSnapshot>();
  private profiles=new Map<string,{value:CreatorProfile;until:number}>();
  constructor(readonly store:FollowStore, private sources:Sources, private metadata:MusicApi['metadata'], private now=Date.now,private youtubeEnabled=()=>true) {}
  private assertProvider(provider:string){if(provider==='youtube'&&!this.youtubeEnabled())throw new MusicSourceError({code:'unsupported',provider:'youtube',retryable:false});}
  run<T>(owner:string,signal:AbortSignal,handler:(signal:AbortSignal)=>Promise<T>):Promise<T> {
    if(this.stop.signal.aborted)throw new MusicSourceError({code:'disposed',retryable:false});
    if(this.work.size>=4)throw new MusicSourceError({code:'busy',retryable:true});
    const controller=new AbortController(),combined=AbortSignal.any([controller.signal,signal,this.stop.signal,AbortSignal.timeout(60000)]);
    const promise=Promise.resolve().then(()=>{combined.throwIfAborted();return handler(combined);}).catch(error=>{
      if(combined.aborted)throw new MusicSourceError({code:combined.reason?.name==='TimeoutError'?'timeout':'cancelled',retryable:true});throw error;
    }).finally(()=>this.work.delete(controller));
    this.work.set(controller,{owner,promise});return promise;
  }
  private rememberProfile(profile:CreatorProfile,ttl=1800000) {
    if(this.profiles.size>=128)this.profiles.delete(this.profiles.keys().next().value!);
    this.profiles.set(creatorKey(profile),{value:profile,until:this.now()+ttl});return profile;
  }
  private async enrich(profile:CreatorProfile,signal:AbortSignal,refresh=false):Promise<CreatorProfile> {
    signal.throwIfAborted();const key=creatorKey(profile),cached=this.profiles.get(key);
    if(!refresh&&cached&&cached.until>this.now()){const value={...profile,artwork:artworkUrl(cached.value.artwork ?? profile.artwork)};this.store.updateArtwork(profile,value.artwork,signal);return value;}
    const current={...profile,artwork:artworkUrl(profile.artwork)};
    if(!refresh&&current.artwork){this.store.updateArtwork(profile,current.artwork,signal);return this.rememberProfile(current);}
    try {
      const real=await this.sources.profile({provider:profile.provider,id:profile.id},AbortSignal.any([signal,AbortSignal.timeout(8000)]));
      signal.throwIfAborted();if(creatorKey(real)!==key)throw new MusicSourceError({code:'upstream',retryable:true});
      const value={...current,artwork:artworkUrl(real.artwork) ?? current.artwork};
      this.store.updateArtwork(profile,value.artwork,signal);return this.rememberProfile(value,value.artwork?1800000:60000);
    } catch(error) {signal.throwIfAborted();return this.rememberProfile(current,60000);}
  }
  async readProfiles(signal:AbortSignal,refresh=false) {
    const state=this.store.read(),creators=state.creators.filter(c=>c.provider!=='youtube'||this.youtubeEnabled()),batch=AbortSignal.any([signal,AbortSignal.timeout(batchReadTimeout)]);let index=0;
    const load=async()=>{while(index<creators.length){
      signal.throwIfAborted();if(batch.aborted)return;
      try{await this.enrich(creators[index++],batch,refresh);}
      catch(error){signal.throwIfAborted();if(batch.aborted)return;throw error;}
    }};
    await Promise.all([load(),load(),load()]);signal.throwIfAborted();return this.store.read();
  }
  async resolve(input:any,signal:AbortSignal):Promise<CreatorProfile> {
    if(!input||typeof input!=='object')throw new LibraryError('invalid-input');
    let profile:CreatorProfile;
    if(input.ref!==undefined) {
      const ref=input.ref;
      if(!ref||!['bilibili','youtube'].includes(ref.provider)||ref.kind!=='video'||typeof ref.id!=='string'||!(ref.provider==='bilibili'?/^BV\w{10}$/:/^[\w-]{11}$/).test(ref.id))throw new LibraryError('invalid-input');
      const entry=await this.metadata(ref,{signal});
      if(!entry.uploader?.id||!entry.uploader.name)throw new MusicSourceError({code:'unsupported',provider:ref.provider,retryable:false});
      const author=validateCreator({provider:ref.provider,id:entry.uploader.id});
      profile={...author,name:entry.uploader.name,url:author.provider==='bilibili'?`https://space.bilibili.com/${author.id}`:`https://www.youtube.com/channel/${author.id}`};
    } else {
      if(typeof input.input!=='string'||input.input.length>500)throw new LibraryError('invalid-input');
      profile=await this.sources.profile(input.input,signal);
    }
    signal.throwIfAborted();return this.enrich(profile,signal);
  }
  async search(input:CreatorSearchRequest,signal:AbortSignal) {
    if(!this.sources.search)throw new MusicSourceError({code:'unsupported',retryable:false});
    const result=await this.sources.search(input,signal);signal.throwIfAborted();
    for(const profile of result.items)this.rememberProfile(profile);
    return result;
  }
  async change(input:any,signal:AbortSignal) {
    if(!input||!['follow','unfollow'].includes(input.action))throw new LibraryError('invalid-input');
    this.store.check(input.revision);
    let creator:FollowedCreator|CreatorRef;
    if(input.action==='unfollow')creator=validateCreator(input.creator);
    else if(input.creator!==undefined)creator={...await this.creator(input.creator,signal),followedAt:this.now()};
    else creator={...await this.resolve(input,signal),followedAt:this.now()};
    signal.throwIfAborted();const state=this.store.change(input.revision,creator,input.action==='follow',signal);
    this.feeds.clear();return {...state,creator};
  }
  async creator(input:unknown,signal:AbortSignal,refresh=false):Promise<CreatorProfile> {
    const ref=validateCreator(input),creator=this.store.read().creators.find(c=>creatorKey(c)===creatorKey(ref));
    this.assertProvider(ref.provider);
    if(creator)return this.enrich(creator,signal,refresh);
    const cached=this.profiles.get(creatorKey(ref));if(cached&&cached.until>this.now())return this.enrich(cached.value,signal,refresh);
    const profile=await this.sources.profile(ref,signal);signal.throwIfAborted();return this.rememberProfile({...profile,artwork:artworkUrl(profile.artwork)});
  }
  private async contentCreator(input:unknown,signal:AbortSignal):Promise<CreatorProfile> {
    signal.throwIfAborted();const ref=validateCreator(input),key=creatorKey(ref);this.assertProvider(ref.provider);
    // Known identity and display metadata are sufficient for content; avatar enrichment runs separately.
    const profile=this.store.read().creators.find(c=>creatorKey(c)===key) ?? this.profiles.get(key)?.value;
    return profile ?? this.creator(ref,signal);
  }
  async collections(input:unknown,owner:string,signal:AbortSignal,cursor?:string){return this.sources.collections(await this.contentCreator(input,signal),owner,signal,cursor);}
  async videos(input:unknown,signal:AbortSignal,cursor?:string){return this.sources.videos(await this.contentCreator(input,signal),signal,cursor);}
  async collectionVideos(input:unknown,collection:string,signal:AbortSignal,cursor?:string){return this.sources.collectionVideos(await this.contentCreator(input,signal),collection,signal,cursor);}
  async videoPage(input:unknown,collection:string|undefined,signal:AbortSignal,page:number,pageSize:number) {
    if(!Number.isSafeInteger(page)||page<1||![20,30,50,100].includes(pageSize)||collection!==undefined&&!collection)throw new LibraryError('invalid-input');
    const creator=await this.contentCreator(input,signal);
    if(creator.provider!=='bilibili')throw new LibraryError('invalid-input');
    const read=(number:number)=>collection?this.sources.collectionVideos(creator,collection,signal,String(number)):this.sources.videos(creator,signal,String(number));
    const sourcePage=Math.floor((page-1)*pageSize/30)+1,first=await read(sourcePage);
    const total=first.total??(sourcePage===1&&!first.cursor?first.items.length:undefined);
    if(total===undefined)throw new MusicSourceError({code:'upstream',retryable:true});
    const actual=Math.min(page,Math.max(1,Math.ceil(total/pageSize))),offset=(actual-1)*pageSize;
    const start=Math.floor(offset/30)+1,end=Math.ceil(Math.min(offset+pageSize,total)/30);
    const items:MusicEntry[]=[];
    for(let number=start;number<=end;number++){
      signal.throwIfAborted();const value=number===sourcePage?first:await read(number);
      items.push(...value.items.slice(number===start?offset%30:0));
    }
    return {items:items.slice(0,pageSize),total,page:actual,pageSize};
  }
  async feed(owner:string,signal:AbortSignal,refresh=false,cursor?:string,provider?:string,pagination?:{page:number;pageSize:number;snapshot?:string}):Promise<FollowFeed> {
    if(pagination&&(!Number.isSafeInteger(pagination.page)||pagination.page<1||![20,30,50,100].includes(pagination.pageSize)||cursor||refresh&&pagination.snapshot))throw new LibraryError('invalid-input');
    if(provider!==undefined&&!['bilibili','youtube'].includes(provider))throw new LibraryError('invalid-input');
    if(provider)this.assertProvider(provider);
    if(!this.youtubeEnabled()&&!provider)provider='bilibili';
    const state=this.store.read();
    const creators=state.creators.filter(c=>!provider||c.provider===provider);
    for(const [key,snapshot] of this.feeds)if(snapshot.until<=this.now())this.feeds.delete(key);
    const size=pagination?.pageSize??60;
    const result=(snapshot:FeedSnapshot,id:string,offset:number):FollowFeed=>{
      if(pagination)offset=(Math.min(pagination.page,Math.max(1,Math.ceil(snapshot.items.length/size)))-1)*size;
      return {items:snapshot.items.slice(offset,offset+size),total:snapshot.items.length,snapshot:id,page:Math.floor(offset/size)+1,pageSize:size,
        ...(offset+size<snapshot.items.length?{cursor:`${id}:${offset+size}`} : {}),warnings:snapshot.warnings,fetchedAt:snapshot.fetchedAt};
    };
    if(pagination?.snapshot){
      const snapshot=this.feeds.get(pagination.snapshot);
      if(!snapshot||snapshot.owner!==owner||snapshot.revision!==state.revision||snapshot.provider!==provider)throw new MusicSourceError({code:'stale-cursor',retryable:true});
      snapshot.until=this.now()+600000;
      return result(snapshot,pagination.snapshot,0);
    }
    if(pagination&&pagination.page!==1)throw new LibraryError('invalid-input');
    if(cursor) {
      const match=cursor.match(/^([\w-]{36}):(\d{1,6})$/),snapshot=match?this.feeds.get(match[1]):undefined;
      if(!snapshot||snapshot.owner!==owner||snapshot.revision!==state.revision||snapshot.provider!==provider)throw new MusicSourceError({code:'stale-cursor',retryable:true});
      return result(snapshot,match![1],Number(match![2]));
    }
    const warnings:FollowFeed['warnings']=[],batch=AbortSignal.any([signal,AbortSignal.timeout(batchReadTimeout)]);let index=0;
    const load=async()=>{while(index<creators.length) {
      signal.throwIfAborted();const creator=creators[index++],cached=this.store.cached(creator);
      if(!refresh&&cached&&this.now()-cached.fetchedAt<300000)continue;
      if(batch.aborted){warnings.push({creator:{provider:creator.provider,id:creator.id},name:creator.name,code:'timeout'});continue;}
      const perCreator=AbortSignal.any([batch,AbortSignal.timeout(20000)]);
      try {const page=await this.sources.videos(creator,perCreator);perCreator.throwIfAborted();this.store.remember(creator,page.items,this.now());}
      catch(error) {signal.throwIfAborted();warnings.push({creator:{provider:creator.provider,id:creator.id},name:creator.name,code:perCreator.aborted?'timeout':(error as {code?:string}).code ?? 'upstream'});}
    }};
    await Promise.all([load(),load(),load()]);signal.throwIfAborted();
    if(this.store.read().revision!==state.revision)throw new LibraryError('conflict',this.store.read().revision);
    const items=[...new Map(creators.flatMap(c=>this.store.cached(c)?.items ?? []).map(item=>[`${item.ref.provider}:${item.ref.id}`,item])).values()]
      .sort((a,b)=>(b.publishedAt ?? 0)-(a.publishedAt ?? 0)||`${a.ref.provider}:${a.ref.id}`.localeCompare(`${b.ref.provider}:${b.ref.id}`));
    const snapshot:FeedSnapshot={owner,revision:state.revision,provider,items,warnings,fetchedAt:this.now(),until:this.now()+600000},id=randomUUID();
    if(this.feeds.size>=16)this.feeds.delete(this.feeds.keys().next().value!);this.feeds.set(id,snapshot);return result(snapshot,id,0);
  }
  cancelOwner(owner?:string){for(const [controller,work] of this.work)if(!owner||work.owner===owner)controller.abort();for(const [key,snapshot] of this.feeds)if(!owner||snapshot.owner===owner)this.feeds.delete(key);this.sources.cancelOwner(owner);}
  async dispose(){this.stop.abort();await Promise.allSettled([...this.work.values()].map(w=>w.promise));this.feeds.clear();this.profiles.clear();this.sources.cancelOwner();await this.sources.dispose?.();this.store.close();}
}
