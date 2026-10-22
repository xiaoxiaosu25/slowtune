import { MusicSourceError, type MusicApi, type EntryRef, type MusicEntry, type ProviderId } from '@studio/music-sources';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import { SearchSettingsStore, validateSong, validateSongSearch } from './search-settings.js';
import { bilibiliSearchPartition, preferredSong, searchPreferredVersions, songKey, songMatchReasons, desktopSongMatchReasons, songSearchText, SearchCandidateMismatch, type SearchEntry, type SearchPage, type SongQuery } from './search-policy.js';
import type { VerifiedAudio } from './audio-quality.js';

export class MusicSearchError extends Error {constructor(public code:'no-match'|'preferred-unavailable'){super(code);}}
export class MusicSearch {
  private facts=new Map<string,{partition:SearchEntry['searchPartition'];until:number}>();
  private matches=new Map<string,{entry:SearchEntry;until:number}>();
  constructor(private store:SearchSettingsStore,private api:Pick<MusicApi,'search'|'metadata'>,
    private partition:(ref:EntryRef,signal:AbortSignal)=>Promise<Record<string,unknown>>,
    private youtubeAvailable:()=>boolean,private context:()=>string,private now=Date.now,
    private verifyPlayback?:(entry:SearchEntry,signal:AbortSignal,audioSupport?:string[],accept?:(facts:MusicEntry)=>boolean)=>Promise<VerifiedAudio|void>,
    private share?:<T>(key:unknown,signal:AbortSignal,task:(signal:AbortSignal)=>Promise<T>)=>Promise<T>){}
  private async classify(entry:SearchEntry,signal:AbortSignal,checkContext=false):Promise<SearchEntry>{
    if(entry.ref.provider!=='bilibili')return entry;
    const context=this.context(),cacheKey=context+':'+entry.ref.id;
    let facts=this.facts.get(cacheKey);
    if(!facts||facts.until<=this.now()){
      try{facts={partition:bilibiliSearchPartition(await this.partition(entry.ref,signal)),until:this.now()+300000};}
      catch(error){
        signal.throwIfAborted();
        if(!(error instanceof MusicSourceError))throw new MusicSourceError({code:'network',provider:'bilibili',retryable:true});
        if(error.code!=='not-found')throw error;
        facts={partition:'unknown',until:this.now()+10000};
      }
      signal.throwIfAborted();
      if(checkContext&&this.context()!==context)throw new LibraryError('conflict');
      if(this.facts.size>=500)this.facts.delete(this.facts.keys().next().value!);
      this.facts.set(cacheKey,facts);
    }
    return {...entry,searchPartition:facts.partition};
  }
  async search(input:unknown,signal:AbortSignal):Promise<SearchPage>{
    return this.share?this.share(['search',input,this.store.read().revision,this.context(),this.youtubeAvailable()],signal,s=>this.searchOnce(input,s)):this.searchOnce(input,signal);
  }
  private async searchOnce(input:unknown,signal:AbortSignal):Promise<SearchPage>{
    const value=input as {provider:ProviderId;query:string;cursor?:string;song?:SongQuery};
    if(!value||!['bilibili','youtube'].includes(value.provider)||typeof value.query!=='string'||!value.query.trim()||value.query.length>512||value.cursor!==undefined&&(typeof value.cursor!=='string'||value.cursor.length>256))throw new LibraryError('invalid-input');
    const song=validateSong(value.song??{title:value.query});
    const result=await this.api.search(value.provider,{query:value.query,mode:'video',limit:20,...(value.cursor?{cursor:value.cursor}:{})},{signal});
    const entries:SearchEntry[]=[];let classificationIssue:SearchPage['classificationIssue'];
    // Enrich in bounded groups while retaining every upstream position and cursor.
    for(let start=0;start<result.items.length;start+=3){
      const group=await Promise.all(result.items.slice(start,start+3).map(async entry=>{
        try{return await this.classify(entry,signal);}
        catch(error){
          signal.throwIfAborted();
          if(error instanceof LibraryError)throw error;
          classificationIssue=error instanceof MusicSourceError?error.toJSON():{code:'network',provider:'bilibili',retryable:true};
          return {...entry,searchPartition:'unknown' as const};
        }
      }));
      signal.throwIfAborted();entries.push(...group);
      if(classificationIssue){entries.push(...result.items.slice(start+group.length).map(entry=>({...entry,...(entry.ref.provider==='bilibili'?{searchPartition:'unknown' as const}:{})})));break;}
    }
    signal.throwIfAborted();
    const state=this.store.read();
    return {...result,items:entries,config:state.config,revision:state.revision,preferred:preferredSong(state.preferred,song),preferredVersions:searchPreferredVersions(state.preferred,song),...(classificationIssue?{classificationIssue}:{})};
  }
  async resolve(input:unknown,signal:AbortSignal):Promise<SearchEntry>{
    return this.share?this.share(['match',input,this.store.read().revision,this.context(),this.youtubeAvailable()],signal,s=>this.resolveOnce(input,s)):this.resolveOnce(input,signal);
  }
  private async resolveOnce(input:unknown,signal:AbortSignal):Promise<SearchEntry>{
    const {song,searchMode,audioSupport}=validateSongSearch(input),state=this.store.read(),preferred=preferredSong(state.preferred,song);
    signal.throwIfAborted();
    if(preferred){
      if(preferred.entry.ref.provider==='youtube'&&!this.youtubeAvailable())throw new MusicSearchError('preferred-unavailable');
      try{const entry=await this.api.metadata(preferred.entry.ref,{signal});signal.throwIfAborted();if(this.store.read().revision!==state.revision)throw new LibraryError('conflict');return entry;}
      catch(error){signal.throwIfAborted();if(error instanceof MusicSourceError&&['not-found','restricted','unsupported'].includes(error.code))throw new MusicSearchError('preferred-unavailable');throw error;}
    }
    const context=this.context(),key=JSON.stringify([state.revision,context,this.youtubeAvailable(),searchMode,searchMode==='title-artists'?audioSupport:undefined,songKey(song),song.durationSeconds]),cached=this.matches.get(key);
    const matchReasons=searchMode==='title-artists'?desktopSongMatchReasons:songMatchReasons;
    const unavailable=new Set<string>(),candidateKey=(entry:SearchEntry)=>JSON.stringify([entry.ref.provider,entry.ref.id]);
    const checkCurrent=()=>{signal.throwIfAborted();if(this.store.read().revision!==state.revision||this.context()!==context)throw new LibraryError('conflict');};
    const playable=async(entry:SearchEntry):Promise<SearchEntry|undefined>=>{
      if(unavailable.has(candidateKey(entry)))return undefined;
      let verifiedAudio:VerifiedAudio|void=undefined;
      if(searchMode==='title-artists'&&this.verifyPlayback){
        try{verifiedAudio=await this.verifyPlayback(entry,signal,audioSupport,facts=>!desktopSongMatchReasons({...entry,title:entry.title===facts.title?entry.title:entry.title+'\n'+facts.title,...(facts.artists?.length?{artists:facts.artists}:{}),...(facts.durationSeconds!==undefined?{durationSeconds:facts.durationSeconds}:{})},state.config,song).length);}
        catch(error){
          checkCurrent();
          if(error instanceof SearchCandidateMismatch){unavailable.add(candidateKey(entry));return undefined;}
          if(!(error instanceof MusicSourceError)||!['not-found','restricted','unsupported','expired'].includes(error.code))throw error;
          unavailable.add(candidateKey(entry));return undefined;
        }
      }
      checkCurrent();return verifiedAudio ? {...entry,ref:verifiedAudio.ref,verifiedAudio} : entry;
    };
    if(cached&&cached.until>this.now()){
      const checked=await playable(cached.entry);if(checked)return checked;
      this.matches.delete(key);
    }
    const queries=[...new Set(searchMode==='title-artists'?[songSearchText(song),song.title]:[song.title])];
    for(const provider of (this.youtubeAvailable()?['bilibili','youtube']:['bilibili']) as ProviderId[]){
      for(const query of queries){
        signal.throwIfAborted();
        // Fall back only after a successful page has no eligible candidate.
        // Every page keeps the provider's own ranking and the original song checks.
        // Desktop resolution stops after the first reliable candidate. Manual
        // search and the paused mobile path still classify the complete page.
        const page:Pick<SearchPage,'items'> & Partial<Pick<SearchPage,'classificationIssue'>>=searchMode==='title-artists'
          ?await this.api.search(provider,{query,mode:'video',limit:20},{signal})
          :await this.search({provider,query,song},signal);
        if('classificationIssue' in page&&page.classificationIssue)throw new MusicSourceError(page.classificationIssue);
        checkCurrent();
        for(const raw of page.items){
          if(unavailable.has(candidateKey(raw)))continue;
          // Reject title, artist and explicit version mismatches before paying
          // for partition facts. Partition decisions are always checked below.
          if(searchMode==='title-artists'&&matchReasons(raw,state.config,song,false).length)continue;
          const entry=searchMode==='title-artists'?await this.classify(raw,signal,true):raw;
          checkCurrent();
          if(matchReasons(entry,state.config,song).length)continue;
          const checked=await playable(entry);if(!checked)continue;
          if(this.matches.size>=250)this.matches.delete(this.matches.keys().next().value!);this.matches.set(key,{entry,until:this.now()+300000});return checked;
        }
      }
    }
    throw new MusicSearchError('no-match');
  }
  dispose(){this.facts.clear();this.matches.clear();}
}
