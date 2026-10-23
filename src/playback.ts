import { preferenceStorage } from './preference-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StudioPlayer } from '@studio/player/core';
import { QueueController, type QueueItem } from '@studio/player/queue';
import { MediaSessionController } from '@studio/player/media-session';
import type { SleepTimerController, SleepTimerRule, SleepTimerSnapshot } from '@studio/player/sleep-timer';
import { createSleepTimer } from './desktop-sleep-timer';
import { BestAudioBridge, retainVerifiedAudio } from './audio-quality';
import type { AudioFormat, EntryRef } from '@studio/music-sources';
import type { MusicClient } from '@studio/music-sources/client';
import { resolveMusicEntries } from '@studio/music-sources';
import type { PlaybackPlan } from '@studio/player';
import { request, type Track, cancelled, errorText, key } from './api';
import type { Song, SongPlaybackSelection, SongVersion, ChartSongContext, SongCatalogLink, SongLibrarySnapshot } from '../server/song-library-types';
import { chooseSongVersion } from '../server/song-library-policy';
import { desktopCatalogSong } from '../server/song-catalog-display';
import type { ChartItem } from '../server/chart-types';
import { type QueueTrack, isTrack, pendingChartTrack, readSavedPlayback, savedQueueEntry, playbackStorageKey, fatalChartError } from './chart-playback';
import { planPartExpansion, type PartMetadataStore } from './multipart';
import { PlaybackAudioAnalysis } from './audio-analysis';
import { PlaybackRecovery } from './playback-recovery';
import { desktopSongSearchOptions } from './song-search';
import { desktopSurface } from './song-search';
import { recordPlaybackDiagnostic, playbackDiagnostics } from './playback-diagnostics';
import { prunePlaybackRecords, DesktopNextPrefetch } from './desktop-continuity';
import { PlaybackClock } from './playback-clock';

// Queue instance IDs must also work on the personal service's LAN HTTP origin.
const queueId=()=> 'queue-'+Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
const prefetchedRef=(requested:EntryRef,actual:EntryRef)=>requested.provider===actual.provider&&requested.kind===actual.kind&&requested.id===actual.id&&(!requested.part||requested.part===actual.part);
async function resolveChartResult(song:Pick<ChartItem,'title'|'artists'>,signal:AbortSignal,audioSupport:string[]):Promise<Track>{
  const result=await request<{entry:Track}>('/api/search/resolve',{title:song.title,...(song.artists?.length?{artists:song.artists}:{}),...desktopSongSearchOptions(audioSupport)},signal);
  signal.throwIfAborted();return result.entry;
}
interface ChartSession {failed:Set<string>;handled:Set<unknown>;allowed:boolean}
interface PlaybackEngine {player:StudioPlayer;queue:QueueController;bridge:BestAudioBridge;recovery:PlaybackRecovery;system:MediaSessionController;sleep:SleepTimerController;tracks:Map<string,QueueTrack>;aliases:Map<string,string>;committed:Map<string,EntryRef>;staged?:{id:string;plan:PlaybackPlan;track:Track;used:boolean};ownCommit?:boolean;restored?:string;releasing?:boolean;sourceStopping?:boolean;sourceSkipping?:boolean;nativeNext?:()=>Promise<boolean>;nativePrevious?:()=>Promise<boolean>;sync?:()=>void;intent:number;pendingRecords:Map<string,number>;created:Map<string,AbortSignal|undefined>;prune:()=>void;prefetch?:DesktopNextPrefetch<Track>;batchSession?:ChartSession;chartSession?:ChartSession;chartSelection?:{id:string;track:Track;signal:AbortSignal};advanceFailure?:()=>void}
const idleSleep:SleepTimerSnapshot={status:'idle',deadline:null,remainingMs:0,trigger:null,action:'pause',remainingItems:null,actionPending:false,error:null};
export function usePlayback(client:MusicClient, youtubeAvailable=false, partsStore?:PartMetadataStore,youtubeEnabled=youtubeAvailable) {
  const [clock] = useState(() => new PlaybackClock());
  const enabled=useRef(youtubeEnabled);enabled.current=youtubeEnabled;
  const libraryChoices=useRef<{songs:Song[];versions:SongVersion[];catalogLinks:SongCatalogLink[]}>({songs:[],versions:[],catalogLinks:[]});
  const blocked=(t:QueueTrack)=>{
    if(enabled.current)return false;
    if(isTrack(t))return t.ref.provider==='youtube';
    if(t.selection?.kind!=='song')return false;
    const selection=t.selection,song=libraryChoices.current.songs.find(s=>s.id===selection.songId);
    const versionId=selection.explicitVersionId??selection.pinnedVersionId??song?.defaultVersionId;
    return libraryChoices.current.versions.some(v=>v.id===versionId&&v.songId===selection.songId&&v.ref.provider==='youtube');
  };
  const readMetadata=async(ref:EntryRef,options:{signal?:AbortSignal}={})=>{
    if(!enabled.current&&ref.provider==='youtube')throw {code:'source-disabled'};
    // Playback checks availability afresh; only catalogue UI reads use the short cache.
    const entry=await client.metadata(ref,options);if(!options.signal?.aborted)partsStore?.seed(entry);return entry;
  };
  const engine=useRef<PlaybackEngine|null>(null);
  const [snapshot,setSnapshot]=useState({current:null as Track|null,currentId:undefined as string|undefined,format:undefined as AudioFormat|undefined,position:0,duration:undefined as number|undefined,playing:false,loading:false,volume:.5,rate:1,muted:false,buffered:[] as {start:number;end:number}[],items:[] as QueueTrack[],order:'sequential',repeat:'off',state:'idle',canPrevious:false,canNext:false});
  const [sleep,setSleep]=useState<SleepTimerSnapshot>(idleSleep),[sleepTimer,setSleepTimer]=useState<SleepTimerController|null>(null);
  const [audioAnalysis,setAudioAnalysis]=useState<PlaybackAudioAnalysis|null>(null);
  const analysisRef=useRef<PlaybackAudioAnalysis|null>(null);
  const [error,setError]=useState(''),[preparing,setPreparing]=useState(false);const operation=useRef<AbortController|null>(null);
  const versionPreparing=useRef<AbortSignal | undefined>(undefined);
  const controlsEpoch=useRef(0);
  const [chartFailures,setChartFailures]=useState<{id:string;title:string;reason:string}[]>([]),[chartSearchTitle,setChartSearchTitle]=useState(''),[chartSearchSong,setChartSearchSong]=useState<ChartItem & {context?:ChartSongContext}>();
  useEffect(()=>{
    const initial=readSavedPlayback(preferenceStorage()),tracks=new Map(initial.tracks.map(t=>[t.resourceId,t]));
    const audio=document.createElement('audio');
    const bridge=new BestAudioBridge(client,audio),aliases=new Map<string,string>(),committed=new Map<string,EntryRef>();
    // Songs start fresh when selected; pause/resume and source recovery retain the live position.
    let recovery:PlaybackRecovery;
    const sourceForPlan=(ref:EntryRef,plan:PlaybackPlan,options:{signal?:AbortSignal})=>plan.metadata?.verifiedAudio?bridge.sourceForPlan(ref,plan,options):bridge.source(ref,options);
    const retainSelection=(plan:PlaybackPlan,next:PlaybackPlan)=>plan.metadata?.verifiedAudio?retainVerifiedAudio(plan,next):next;
    const refresh=(id:string,plan:PlaybackPlan,signal:AbortSignal)=>recovery.trackSource(async()=>{const ref=committed.get(id),source=ref?await sourceForPlan(ref,plan,{signal}):undefined;const refreshed=await bridge.resolver.resolveUrl!(source?.resourceId??aliases.get(id)??id,plan,'retry',{signal});return typeof refreshed==='string'?{...plan,playUrl:refreshed,resourceId:id}:{...retainSelection(plan,refreshed),resourceId:id};});
    const player=new StudioPlayer({nativeElementTag:'audio',sourceResolver:{...bridge.resolver,
      prepareSource:(id,plan,context)=>refresh(id,plan,context.signal),
      resolveUrl:(id,plan,reason,context)=>recovery.trackSource(async()=>{const ref=committed.get(id),source=ref?await sourceForPlan(ref,plan,{signal:context?.signal}):undefined;const refreshed=await bridge.resolver.resolveUrl!(source?.resourceId??aliases.get(id)??id,plan,reason,context);return typeof refreshed==='string'?refreshed:{...retainSelection(plan,refreshed),resourceId:id};}),
      recoverSource:(id,plan,context)=>recovery.trackSource(async()=>{recovery.capture(context.positionSeconds,context.paused);const ref=committed.get(id),source=ref?await sourceForPlan(ref,plan,{signal:context.signal}):undefined;const recovered=await bridge.resolver.recoverSource?.(source?.resourceId??aliases.get(id)??id,plan,context);return recovered?{...retainSelection(plan,recovered),resourceId:id}:null;})
    },autoResume:false});
    recovery=new PlaybackRecovery(player,audio,desktopSurface()?desktopSurface:false);
    audio.dataset.productMedia='true';audio.preload='none';audio.hidden=true;document.body.append(audio);player.attach(audio);player.setVolume(initial.volume);
    const analysis=new PlaybackAudioAnalysis(audio);analysisRef.current=analysis;setAudioAnalysis(analysis);
    // Rate and mute are user preferences: they survive reloads and later source switches.
    if(initial.rate!==1)player.setPlaybackRate(initial.rate);
    if(initial.muted)player.setMuted(true);
    const queue=new QueueController(player,{order:initial.order,repeat:initial.repeat,autoAdvance:true});
    const system=new MediaSessionController(player,{queue,getMetadata:()=>{const track=tracks.get(queue.snapshot.current?.id??'');return track?{title:track.title,artist:track.artists?.join(' / ')??track.uploader?.name,artwork:track.artwork?[{src:track.artwork}]:[]}:null;}});
    const sleep=createSleepTimer(player,audio);
    engine.current={player,queue,bridge,recovery,system,sleep,tracks,aliases,committed,restored:initial.current,intent:0,pendingRecords:new Map(),created:new Map(),prune:()=>{},...(initial.tracks.some(t=>t.chartItem)?{chartSession:{failed:new Set<string>(),handled:new Set<unknown>(),allowed:false}}:{})};
    const owned=engine.current;
    owned.prune=()=>{
      if(!desktopSurface())return;
      const q=queue.snapshot,queued=new Set(q.items.map(item=>item.id));
      for(const [id,signal]of owned.created)if(queued.has(id)||signal?.aborted)owned.created.delete(id);
      const ids=new Set([...queued,...owned.pendingRecords.keys(),...owned.created.keys()]);
      if(owned.restored&&!ids.has(owned.restored))owned.restored=undefined;
      if(owned.staged)ids.add(owned.staged.id);
      const live=player.currentPlan&&player.state!=='stopped'?player.currentResourceId:undefined;
      if(live)for(const id of tracks.keys())if(live===id||['queue:','song:','chart:'].some(prefix=>live===prefix+id))ids.add(id);
      prunePlaybackRecords(owned,ids,live?[live]:[]);
      for(const session of [owned.chartSession,owned.batchSession])if(session){for(const id of session.failed)if(!ids.has(id))session.failed.delete(id);if(!ids.size)session.handled.clear();}
    };
    if(desktopSurface())owned.prefetch=new DesktopNextPrefetch<Track>(entry=>{const token=entry.verifiedAudio?.preparationToken;if(token)void request('/api/playback/prefetch',{discard:token},AbortSignal.timeout(3000)).catch(()=>{});});
    // Native media keys and automatic advancement use the same availability rules.
    const next=queue.next.bind(queue),previous=queue.previous.bind(queue);
    engine.current.nativeNext=next;
    engine.current.nativePrevious=previous;
    queue.next=()=>enabled.current?next():advancePlayable(engine.current!,1);
    queue.previous=()=>enabled.current?previous():advancePlayable(engine.current!,-1);
    setSleepTimer(sleep);
    const lazy=(t:QueueTrack):QueueItem=>t.selection?songQueueItem(engine.current!,t,t.selection):t.chartItem?chartQueueItem(engine.current!,t):deferredItem(engine.current!,t as Track,t.resourceId);
    queue.setItems(initial.tracks.map(lazy));
    let alive=true,lastSaved='';
    const update=()=>{
      if(!alive||engine.current?.releasing)return;const q=queue.snapshot,e=engine.current;
      e?.prune();
      const items=q.items.map(i=>tracks.get(i.id)!).filter(Boolean),base=tracks.get(q.current?.id??e?.restored??'')??null;
      const artwork=player.currentMetadata?.artwork;
      const current=base&&isTrack(base)?{...base,...(!base.artwork&&base.sourceArtwork===undefined&&typeof artwork==='string'?{artwork}:{} )}:null;
      if(q.current && e)e.restored=undefined;
      // Failed source preparation retains the previous plan; only expose an applied queue selection's format.
      const format=q.loaded?player.currentMetadata?.format as AudioFormat|undefined:undefined;
      clock.publish({position:player.currentTime,duration:Number.isFinite(player.duration)&&player.duration>0?player.duration:current?.durationSeconds,buffered:player.buffered.map(range=>({start:range.start,end:range.end}))});
      setSnapshot({current,currentId:q.current?.id??e?.restored,format,position:player.currentTime,duration:Number.isFinite(player.duration)&&player.duration>0?player.duration:current?.durationSeconds,playing:player.state==='playing'&&!player.paused,loading:q.loading,volume:player.volume,rate:player.playbackRate,muted:player.muted,buffered:player.buffered.map(range=>({start:range.start,end:range.end})),items,order:q.order,repeat:q.repeat,state:player.state,canPrevious:q.canPrevious,canNext:q.canNext});
      try {const saved=JSON.stringify({version:3,items:items.map(savedQueueEntry),current:q.current?.id??e?.restored,order:q.order,repeat:q.repeat,volume:player.volume,rate:player.playbackRate,muted:player.muted});if(saved!==lastSaved){preferenceStorage().setItem(playbackStorageKey,saved);lastSaved=saved;}}catch{setError(window.slowTuneDesktop?'本地播放偏好无法保存；歌单与收藏仍保存在本应用的资料库。':'浏览器无法保存播放资料；歌单与收藏仍由服务保存。');}
      if(!q.loading&&e?.advanceFailure){const advance=e.advanceFailure;e.advanceFailure=undefined;queueMicrotask(advance);}
    };
    engine.current.sync=update;
    // The media clock never changes the saved queue. Keep its objects stable and
    // avoid serializing hundreds of entries and writing synchronous storage per tick.
    let queueIdentity='',prefetchCurrent:string|undefined;
    const prefetchQueue=()=>{
      if(!owned.prefetch)return;
      const q=queue.snapshot,identity=JSON.stringify([q.items.map(item=>item.id),q.order,q.repeat]);
      if(queueIdentity!==identity){queueIdentity=identity;owned.prefetch.cancel();}
      if(prefetchCurrent!==q.current?.id)owned.prefetch.retain([q.current?.id??'']);
      else owned.prefetch.retain([queue.peekNext()?.id??'']);
      prefetchCurrent=q.current?.id;
    };
    const prefetchNext=()=>{
      if(!desktopSurface()||!owned.prefetch||operation.current||owned.releasing||navigator.onLine===false||player.paused||player.failed)return;
      const remaining=player.duration-player.currentTime;
      if(!Number.isFinite(remaining)||remaining<=0||remaining>8||!player.buffered.some(range=>range.start<=player.currentTime&&range.end>=player.duration-.25)||queue.snapshot.loading)return;
      const next=queue.peekNext(),track=next?tracks.get(next.id):undefined;
      if(!next||!track||blocked(track))return;
      const library=libraryChoices.current;let chosen:ReturnType<typeof chooseSongVersion>|undefined;
      try{chosen=track.selection?chooseSongVersion(track.selection,library.songs,library.versions,library.catalogLinks):undefined;}catch{return;}
      const ref=track.selection?(chosen?.kind==='source'?chosen.ref:undefined):isTrack(track)?track.ref:undefined;
      if(!ref||!enabled.current&&ref.provider==='youtube'||!client.capabilities(ref.provider).operations.includes('slowtune-desktop-audio'))return;
      const identity=JSON.stringify([queueIdentity,queue.snapshot.current?.id,next.id]);
      owned.prefetch.start(next.id,identity,async signal=>{const result=await request<{entry:Track}>('/api/playback/prefetch',{ref,audioSupport:bridge.audioSupport},signal);if(!result.entry.verifiedAudio?.preparationToken)throw new Error('Prefetch unavailable');return result.entry;});
    };
    const progress=()=>{
      if(!alive||engine.current?.releasing)return;
      prefetchNext();
      const value={position:player.currentTime,duration:Number.isFinite(player.duration)&&player.duration>0?player.duration:clock.getSnapshot().duration,buffered:player.buffered.map(range=>({start:range.start,end:range.end}))};
      clock.publish(value);
      if(!desktopSurface())setSnapshot(old=>({...old,...value}));
    };
    const unsubs=[()=>recovery.dispose(),player.on('timeupdate',progress),...['durationchange','pause','statechange','volumechange','ratechange','stop'].map(event=>player.on(event as 'timeupdate',update))];
    const suspend=window.slowTuneDesktop?.onCommand(command=>{if(command==='suspend')owned.prefetch?.cancel();});if(suspend)unsubs.push(suspend);
    unsubs.push(player.on('diagnostic',event=>recordPlaybackDiagnostic({operation:'player',code:event.code,at:event.timestamp,...(event.elapsedMs!==undefined?{elapsedMs:event.elapsedMs}:{})})));
    unsubs.push(player.on('playing',()=>{if(desktopSurface()&&recovery.preparing)setError('');system.activate();update();}),player.on('pauseintent',()=>{owned.prefetch?.cancel();const e=engine.current;if(e&&!e.sourceStopping){e.intent++;if(e.chartSession)e.chartSession.allowed=false;if(e.batchSession)e.batchSession.allowed=false;}}));
    unsubs.push(player.on('loadstart',()=>{owned.prefetch?.retain([queue.snapshot.current?.id??'']);const e=engine.current;if(e&&!e.ownCommit)e.intent++;}),player.on('stop',()=>{owned.prefetch?.cancel();const e=engine.current;if(e&&!e.sourceStopping)e.intent++;}));
    const queueError=(event:Event)=>{
      const e=engine.current,issue=(event as CustomEvent).detail,id=queue.snapshot.current?.id,track=id?tracks.get(id):undefined;
      if(!e||!id||cancelled(issue))return;
      if((issue as {code?:string}).code==='source-disabled'){
        if(e.sourceSkipping)return;
        const intent=e.intent;
        e.advanceFailure=()=>{if(!alive||e.releasing||e.intent!==intent||queue.snapshot.current?.id!==id)return;void advancePlayable(e,1).catch(()=>{});};
        update();return;
      }
      const session=e.chartSession??e.batchSession;
      const failure=desktopSurface()&&(issue as Error)?.name==='TimeoutError'?{code:'timeout'}:issue;
      // Metadata/source failures can skip a list member. A failure after its
      // plan was applied belongs to continuity recovery and retains its checkpoint.
      if(e.batchSession&&queue.snapshot.loaded){setError(errorText(failure));return;}
      if(!session?.allowed||!track||e.chartSession&&!track.chartItem){setError(errorText(failure));return;}
      if(session.handled.has(issue))return;
      session.handled.add(issue);
      if(desktopSurface()&&session.handled.size>500)session.handled.delete(session.handled.values().next().value);
      if(!session.failed.has(id)){session.failed.add(id);setChartFailures(old=>[...old,{id,title:track.chartItem?.title??track.title,reason:errorText(failure)}]);}
      if(fatalChartError(issue)){session.allowed=false;setError(errorText(issue));return;}
      const intent=e.intent;
      e.advanceFailure=()=>{
        if(!alive||e.releasing||e.intent!==intent||(e.chartSession??e.batchSession)!==session||!session.allowed||queue.snapshot.current?.id!==id)return;
        const q=queue.snapshot,peek=queue.peekNext();
        const candidates=q.order==='shuffle'||q.repeat==='all'?[...q.items.slice(q.index+1),...q.items.slice(0,q.index)]:q.items.slice(q.index+1);
        const next=peek&&!session.failed.has(peek.id)?peek:candidates.find(item=>!session.failed.has(item.id));
        if(!next){session.allowed=false;setError(e.chartSession?'榜单播放已结束，未能播放的歌曲已列出。':'列表播放已结束，未能播放的歌曲已列出。');void player.stop().catch(()=>{});return;}
        void queue.selectId(next.id,{restart:true}).catch(()=>{});
      };
      update();
    };
    queue.addEventListener('error',queueError);
    // Sleep rules stay outside the playback queue: the countdown ticks every second while it runs.
    const onSleep=()=>setSleep(sleep.snapshot);
    const onSleepExpire=()=>{if(desktopSurface()){operation.current?.abort();owned.recovery.cancelEnvironment();}};
    const onSleepComplete=()=>{if(desktopSurface()&&sleep.snapshot.status==='expired'&&sleep.snapshot.action==='close')window.slowTuneDesktop?.quit();};
    sleep.addEventListener('change',onSleep);
    sleep.addEventListener('expire',onSleepExpire);
    sleep.addEventListener('complete',onSleepComplete);
    queue.addEventListener('change',update);queue.addEventListener('change',prefetchQueue);prefetchQueue();update();
    const leave=()=>{owned.prefetch?.cancel();operation.current?.abort();player.pause();void player.stop().finally(()=>bridge.dispose()).catch(()=>{});};
    window.addEventListener('pagehide',leave);
    const offline=()=>owned.prefetch?.cancel();window.addEventListener('offline',offline);
    return()=>{alive=false;owned.prefetch?.cancel();operation.current?.abort();unsubs.forEach(fn=>fn());window.removeEventListener('pagehide',leave);window.removeEventListener('offline',offline);sleep.removeEventListener('change',onSleep);sleep.removeEventListener('expire',onSleepExpire);sleep.removeEventListener('complete',onSleepComplete);queue.removeEventListener('change',update);queue.removeEventListener('change',prefetchQueue);queue.removeEventListener('error',queueError);queue.destroy();system.destroy();sleep.destroy();setSleepTimer(null);setSleep(idleSleep);void player.destroyAsync().finally(()=>{analysis.dispose();tracks.clear();aliases.clear();committed.clear();return bridge.dispose();}).catch(()=>{});audio.remove();engine.current=null;analysisRef.current=null;};
  },[client]);
  const nextPlayable=(e:PlaybackEngine,direction:1|-1)=>{
    const q=e.queue.snapshot,items=q.items;
    const eligible=(item:Readonly<QueueItem>)=>{const track=e.tracks.get(item.id);return !!track&&!blocked(track);};
    if(direction===1&&q.order==='shuffle'){
      const peek=e.queue.peekNext();if(peek&&eligible(peek))return peek;
      const choices=items.filter(item=>item.id!==q.current?.id&&eligible(item));
      if(choices.length)return choices[Math.floor(Math.random()*choices.length)];
      return q.repeat==='all'&&q.current&&eligible(q.current)?q.current:undefined;
    }
    const index=q.current?q.index:items.findIndex(item=>item.id===e.restored);
    for(let step=1;step<=items.length;step++){
      let at=index+direction*step;
      if(at<0||at>=items.length){if(q.repeat==='off')break;at=((at%items.length)+items.length)%items.length;}
      const item=items[at];if(item&&eligible(item))return item;
    }
  };
  const advancePlayable=async(e:PlaybackEngine,direction:1|-1)=>{
    const q=e.queue.snapshot,native=direction===1?e.nativeNext:e.nativePrevious;
    // Let the fixed queue move its history cursor even when a disabled entry
    // cannot load. Selecting the previous ID as a new item would append history.
    if(native&&(direction===-1||q.current)){
      resumeChart(e);
      e.sourceSkipping=true;
      try{
        for(let attempt=0;attempt<=q.history.length+q.items.length;attempt++){
          const played=await native().catch(error=>{if((error as {code?:string}).code==='source-disabled')return false;throw error;}),track=e.tracks.get(e.queue.snapshot.current?.id??'');
          if(!track||!blocked(track))return played;
          if(!(direction===1?e.queue.snapshot.canNext:e.queue.snapshot.canPrevious))break;
        }
      }finally{e.sourceSkipping=false;}
      await e.player.stop();if(!q.items.some(item=>{const track=e.tracks.get(item.id);return track&&!blocked(track);}))setError('当前队列没有可播放歌曲，YouTube 已关闭。');return false;
    }
    const next=nextPlayable(e,direction);
    if(next){resumeChart(e);return e.queue.selectId(next.id,{restart:true});}
    const playable=q.items.some(item=>{const track=e.tracks.get(item.id);return track&&!blocked(track);});
    const current=e.tracks.get(q.current?.id??e.restored??'');
    if(!playable||current&&blocked(current))await e.player.stop();
    if(!playable)setError('当前队列没有可播放歌曲，YouTube 已关闭。');return false;
  };
  useEffect(()=>{
    if(youtubeEnabled)return;const e=engine.current;if(!e)return;
    const q=e.queue.snapshot,track=e.tracks.get(q.current?.id??e.restored??'');
    if(!track||!blocked(track))return;
    const resume=q.loading||e.player.state==='playing';
    if(resume)operation.current?.abort();
    const intent=++e.intent;
    if(q.loaded||q.loading){e.sourceStopping=true;void e.player.stop().then(()=>{if(resume&&e.intent===intent&&!enabled.current)return advancePlayable(e,1);}).catch(()=>{}).finally(()=>{e.sourceStopping=false;});}
    e.sync?.();
  },[youtubeEnabled]);
  const run=async(fn:(e:NonNullable<typeof engine.current>,signal:AbortSignal)=>Promise<unknown>|unknown,preparesSource=true,deadline?:number)=>{
    if(!engine.current)return;operation.current?.abort();const c=new AbortController();operation.current=c;engine.current.intent++;setError('');setChartSearchTitle('');
    engine.current.prefetch?.foreground();
    engine.current.recovery.cancelEnvironment();
    const target=engine.current,start=performance.now(),abort=()=>target.player.sourceController.cancelSourcePreparation();
    let succeeded=false;
    const desktop=desktopSurface(),timer=desktop&&preparesSource?setTimeout(()=>c.abort(new DOMException('Playback operation timed out','TimeoutError')),Math.max(1,(deadline??Date.now()+60000)-Date.now())):undefined;
    if(desktop)c.signal.addEventListener('abort',abort,{once:true});
    // Seeking and transport commands must not turn a focused Play button into Cancel.
    setPreparing(preparesSource);
    try {const result=await fn(engine.current,c.signal);if(operation.current===c&&c.signal.aborted&&c.signal.reason?.name==='TimeoutError')setError(errorText({code:'timeout'}));succeeded=!c.signal.aborted&&result!==false;return succeeded;}
    catch(e){if(operation.current===c&&c.signal.aborted&&c.signal.reason?.name==='TimeoutError')setError(errorText({code:'timeout'}));else if(!c.signal.aborted&&!cancelled(e)&&!(e as {chartEmpty?:boolean}).chartEmpty&&!(engine.current?.chartSession??engine.current?.batchSession)?.handled.has(e))setError(errorText(desktop&&(e as Error).name==='TimeoutError'?{code:'timeout'}:e));return false;}
    finally{for(const [id,owner]of target.created)if(owner===c.signal)target.created.delete(id);target.prune();clearTimeout(timer);c.signal.removeEventListener('abort',abort);recordPlaybackDiagnostic({operation:preparesSource?'playback-command':'transport-command',code:c.signal.aborted?c.signal.reason?.name==='TimeoutError'?'timeout':'cancelled':succeeded?'complete':'failure',at:Date.now(),elapsedMs:performance.now()-start});if(operation.current===c){setPreparing(false);operation.current=null;}}
  };
  const preparingRecord=async<T,>(e:PlaybackEngine,id:string,signal:AbortSignal,task:()=>Promise<T>)=>{
    e.pendingRecords.set(id,(e.pendingRecords.get(id)??0)+1);
    try{signal.throwIfAborted();return await task();}
    finally{const count=(e.pendingRecords.get(id)??1)-1;if(count)e.pendingRecords.set(id,count);else e.pendingRecords.delete(id);e.prune();}
  };
  const chartQueueItem=(e:PlaybackEngine,t:QueueTrack):QueueItem=>{
    const id=t.resourceId,resourceId='chart:'+id;e.tracks.set(id,t);e.created.set(id,operation.current?.signal);
    return {id,title:t.title,artist:t.artists?.join(', '),artwork:t.artwork?[{src:t.artwork}]:undefined,source:{resourceId,resolveTimeoutSeconds:60,prepare:ctx=>preparingRecord(e,id,ctx.signal,async()=>{
      // The fixed queue still selects failed entries when it wraps. Skip their
      // source I/O; the error handler advances again without duplicating them.
      if(e.chartSession?.allowed&&e.chartSession.failed.has(id))throw {code:'not-found'};
      const existing=e.tracks.get(id)!;
      const songSelection=e.staged?.id===id?e.staged.track.selection:existing.selection;
      if(e.staged?.id===id||songSelection?.kind==='song'||desktopSurface()&&songSelection?.kind==='source')return prepareSongQueueSource(e,existing,songSelection!,resourceId,ctx.signal);
      const selection=e.chartSelection;
      const result=selection?.id===id&&!selection.signal.aborted?selection.track:await resolveChartResult(existing.chartItem!,ctx.signal,e.bridge.audioSupport);
      const metadata=await readMetadata(result.ref,{signal:ctx.signal});ctx.signal.throwIfAborted();
      const resolvedEntry=metadata.ref.part?metadata:metadata.parts?.[0]??metadata;
      const entry={...resolvedEntry,...(result.verifiedAudio&&key(result.verifiedAudio.ref)===key(resolvedEntry.ref)?{verifiedAudio:result.verifiedAudio}:{})};
      e.tracks.set(id,{...entry,resourceId:id,chartItem:t.chartItem});e.sync?.();
      const source=await e.bridge.sourceFrom(entry,{signal:ctx.signal}),plan=await source.prepare(ctx);
      if(ctx.signal.aborted){if(desktopSurface())e.player.sourceController.releaseUnusedPlan(plan);ctx.signal.throwIfAborted();}
      e.aliases.set(resourceId,source.resourceId);if(desktopSurface())e.committed.set(resourceId,entry.ref);return {...plan,resourceId};
    })}};
  };
  const prepareSelection=async(e:PlaybackEngine,t:QueueTrack,selection:SongPlaybackSelection,signal:AbortSignal)=>{
    const library=libraryChoices.current,chosen=selection.kind==='song'&&!library.songs.some(song=>song.id===selection.songId)?undefined:chooseSongVersion(selection,library.songs,library.versions,library.catalogLinks);
    // A saved song is a local source index. Only unresolved titles need server-side search.
    const known=chosen?.kind==='source'?library.versions.find(version=>version.id===chosen.versionId&&key(version.ref)===key(chosen.ref)):undefined;
    // An exact saved version already supplies the source identity and display facts.
    // formats/prepare still validate it upstream; a separate metadata round trip
    // before them adds latency without making the eventual media URL fresher.
    const entry:Track|undefined=known?.facts?{ref:known.ref,resourceId:key(known.ref),title:known.facts.title,artists:known.facts.artists,artwork:known.facts.artwork,durationSeconds:known.facts.durationSeconds,url:known.facts.url??(known.ref.provider==='bilibili'?`https://www.bilibili.com/video/${known.ref.id}`:`https://www.youtube.com/watch?v=${known.ref.id}`),...(known.facts.uploader?{uploader:{name:known.facts.uploader,...(known.facts.uploaderId?{id:known.facts.uploaderId}:{})}}:{})}:undefined;
    const warm=desktopSurface()?e.prefetch?.take(t.resourceId,entry=>chosen?.kind==='source'&&prefetchedRef(chosen.ref,entry.ref)):undefined;
    const result=chosen?.kind==='source'?{entry:warm??entry??await readMetadata(chosen.ref,{signal}),song:library.songs.find(song=>song.id===chosen.songId),versionId:chosen.versionId}:await request<{entry:Track;song?:Song;versionId?:string}>('/api/song-library/playback',{selection,...desktopSongSearchOptions(e.bridge.audioSupport)},signal);
    if(result.song&&desktopSongSearchOptions().searchMode)result.song=desktopCatalogSong(result.song,library);
    signal.throwIfAborted();if(!enabled.current&&result.entry.ref.provider==='youtube')throw {code:'source-disabled'};
    const source=await e.bridge.sourceFrom(result.entry,{signal}),original=await source.prepare({signal,restart:true});
    if(signal.aborted){e.player.sourceController.releaseUnusedPlan(original);signal.throwIfAborted();}
    const track:Track={...result.entry,...(original.durationSeconds!==undefined?{durationSeconds:original.durationSeconds}:{}),resourceId:t.resourceId,selection,...(t.partsGroupId?{partsGroupId:t.partsGroupId}:{}),...(t.chartItem?{chartItem:t.chartItem}:{}),...((selection.kind==='source'||selection.kind==='chart')&&selection.context?{chartContext:selection.context}:{}),...(result.song?{songId:result.song.id,title:result.song.title,artists:result.song.artists,artwork:result.song.artwork??result.entry.artwork,...(desktopSongSearchOptions().searchMode?{sourceArtwork:result.entry.artwork??null,sourceTitle:result.entry.title}:{})}:{}),...(result.versionId?{versionId:result.versionId}:{})};
    if(desktopSurface())track.sourceTitle=result.entry.title;
    if(selection.kind==='chart'&&!result.song){track.title=selection.context.title;track.artists=selection.context.artists;track.artwork=selection.context.artwork??track.artwork;}
    return {track,plan:{...original,resourceId:'song:'+t.resourceId,metadata:{...original.metadata,title:track.title,artists:track.artists,artwork:track.artwork}},sourceId:source.resourceId};
  };
  const prepareSongQueueSource=async(e:PlaybackEngine,t:QueueTrack,selection:SongPlaybackSelection,resourceId:string,signal:AbortSignal)=>{
    const id=t.resourceId;
    if(e.chartSession?.allowed&&e.chartSession.failed.has(id))throw {code:'not-found'};
    const staged=e.staged;
    if(blocked(staged?.id===id?staged.track:e.tracks.get(id)??t))throw {code:'source-disabled'};
    if(staged?.id===id){signal.throwIfAborted();staged.used=true;e.staged=undefined;e.tracks.set(id,staged.track);e.committed.set(resourceId,staged.track.ref);return {...staged.plan,resourceId};}
    const original=e.tracks.get(id)?.selection??selection,explicit=e.chartSelection;
    const requested:SongPlaybackSelection=explicit?.id===id&&!explicit.signal.aborted?{kind:'source',ref:explicit.track.ref as any,...(original.kind==='song'?{songId:original.songId}:original.kind==='chart'?{context:original.context}:{})}:original;
    const prepared=await prepareSelection(e,t,requested,signal);
    // A one-time explicit source must not become the queue's permanent automatic choice.
    if(requested!==original)prepared.track.selection=original;
    if(signal.aborted||blocked(prepared.track)){e.player.sourceController.releaseUnusedPlan(prepared.plan);signal.throwIfAborted();throw {code:'source-disabled'};}
    e.tracks.set(id,prepared.track);e.aliases.set(resourceId,prepared.sourceId);e.committed.set(resourceId,prepared.track.ref);return {...prepared.plan,resourceId};
  };
  const songQueueItem=(e:PlaybackEngine,t:QueueTrack,selection:SongPlaybackSelection):QueueItem=>{
    const id=t.resourceId,resourceId='song:'+id;e.tracks.set(id,t);e.created.set(id,operation.current?.signal);
    return {id,title:t.title,artist:t.artists?.join(' / '),artwork:t.artwork?[{src:t.artwork}]:undefined,source:{resourceId,resolveTimeoutSeconds:60,prepare:ctx=>preparingRecord(e,id,ctx.signal,()=>prepareSongQueueSource(e,t,selection,resourceId,ctx.signal))}};
  };
  const selectionTrack=(selection:SongPlaybackSelection,song:Pick<Song,'title'|'artists'|'artwork'>):QueueTrack=>selection.kind==='chart'?{...pendingChartTrack({rank:selection.context.rank??1,title:song.title,artists:song.artists,artwork:song.artwork},queueId()),selection}:{kind:'song',selection,resourceId:queueId(),title:song.title,artists:song.artists,artwork:song.artwork};
  const playSelection=(selection:SongPlaybackSelection,song:Pick<Song,'title'|'artists'|'artwork'>,replaceCurrent=false)=>run(async(e,signal)=>{
    const current=e.queue.snapshot.current,id=current?.id??(desktopSurface()&&replaceCurrent?e.restored:undefined),active=id?e.tracks.get(id):undefined;
    if(id&&active&&(desktopSurface()&&replaceCurrent||isTrack(active)&&selection.kind==='song'&&active.songId===selection.songId&&selection.explicitVersionId)){
      const intent=e.intent,wasStopped=desktopSurface()&&replaceCurrent&&e.player.state==='stopped';let prepared:Awaited<ReturnType<typeof prepareSelection>>|undefined,staged:PlaybackEngine['staged'];versionPreparing.current=signal;
      try{
        prepared=await prepareSelection(e,active,selection,signal);
        signal.throwIfAborted();if(e.intent!==intent||(e.queue.snapshot.current?.id??e.restored)!==id||e.sleep.snapshot.status==='expired'||!wasStopped&&e.player.state==='stopped'||!enabled.current&&prepared.track.ref.provider==='youtube')return false;
        staged={id,track:prepared.track,plan:prepared.plan,used:false};e.staged=staged;resumeBatchItem(e,id);e.ownCommit=true;
        const controls={rate:e.player.playbackRate,volume:e.player.volume,muted:e.player.muted},epoch=controlsEpoch.current;
        let task;try{task=e.queue.selectId(id,{restart:true,autoplay:!current||!e.player.paused&&e.player.playbackRequested});}finally{e.ownCommit=false;}
        const result=await task;
        // The browser can reset native rate while replacing the media URL. Restore
        // the latest committed controls unless a newer user control superseded them.
        if(staged.used&&e.queue.snapshot.current?.id===id&&controlsEpoch.current===epoch){e.player.setPlaybackRate(controls.rate);e.player.setVolume(controls.volume);e.player.setMuted(controls.muted);e.sync?.();}
        return result;
      }finally{if(versionPreparing.current===signal)versionPreparing.current=undefined;if(e.staged===staged)e.staged=undefined;if(prepared&&!staged?.used)e.player.sourceController.releaseUnusedPlan(prepared.plan);}
    }
    const track=selectionTrack(selection,song),intent=e.intent,previousId=e.queue.snapshot.current?.id;
    let prepared:Awaited<ReturnType<typeof prepareSelection>>|undefined,staged:PlaybackEngine['staged'];versionPreparing.current=signal;
    try{
      prepared=await prepareSelection(e,track,selection,signal);signal.throwIfAborted();
      if(e.intent!==intent||e.queue.snapshot.current?.id!==previousId||blocked(prepared.track))return false;
      const q=e.queue.snapshot,resolved=prepared.track;
      const matches=q.items.filter(item=>{
        const candidate=e.tracks.get(item.id);if(!candidate)return false;
        const saved=candidate.selection;
        // Keep repeated playlist members and their pinned versions distinct.
        if(selection.kind==='song'&&saved?.kind==='song')return saved.songId===selection.songId&&saved.pinnedVersionId===selection.pinnedVersionId;
        return isTrack(candidate)&&key(candidate.ref)===key(resolved.ref);
      });
      const existing=matches.find(item=>item.id===(q.current?.id??e.restored))??matches[0];
      if(!existing&&q.items.length>=500)throw {code:'queue-limit'};
      const item=existing??songQueueItem(e,track,selection),retained=existing?e.tracks.get(existing.id):undefined;
      const selected={...retained,...resolved,resourceId:item.id,...(retained?.partsGroupId?{partsGroupId:retained.partsGroupId}:{}),...(retained?.chartItem?{chartItem:retained.chartItem}:{}),...(retained?.selection&&selection.kind!=='song'?{selection:retained.selection}:{})};
      staged={id:item.id,track:selected,plan:prepared.plan,used:false};e.staged=staged;
      if(!existing){
        if(q.current)e.queue.insertNext([item]);
        else {const at=q.items.findIndex(candidate=>candidate.id===e.restored);e.queue.add([item],at<0?0:at+1);}
      }
      if(e.chartSession){e.chartSession.allowed=true;if(existing)e.chartSession.failed.delete(existing.id);}
      resumeBatchItem(e,item.id);
      e.ownCommit=true;
      const controls={rate:e.player.playbackRate,volume:e.player.volume,muted:e.player.muted},epoch=controlsEpoch.current;
      let task;try{task=e.queue.selectId(item.id,{restart:true});}finally{e.ownCommit=false;}
      const result=await task;
      if(staged.used&&controlsEpoch.current===epoch){e.player.setPlaybackRate(controls.rate);e.player.setVolume(controls.volume);e.player.setMuted(controls.muted);}
      return result;
    }catch(issue){
      if(!signal.aborted&&!cancelled(issue)&&(selection.kind==='chart'||selection.kind==='query')){setChartSearchTitle(song.title);setChartSearchSong({rank:1,title:song.title,artists:song.artists,...(selection.kind==='chart'?{context:selection.context}:{})});}
      throw issue;
    }finally{if(versionPreparing.current===signal)versionPreparing.current=undefined;if(e.staged===staged)e.staged=undefined;if(prepared&&!staged?.used)e.player.sourceController.releaseUnusedPlan(prepared.plan);}
  });
  const normalQueue=(e:PlaybackEngine)=>{e.prefetch?.cancel();e.chartSession=undefined;e.batchSession=undefined;e.advanceFailure=undefined;setChartFailures([]);};
  const resumeChart=(e:PlaybackEngine)=>{for(const session of [e.chartSession,e.batchSession])if(session){session.allowed=true;session.failed.delete(e.queue.snapshot.current?.id??'');}};
  const resumeBatchItem=(e:PlaybackEngine,id:string)=>{
    const session=desktopSurface()?e.batchSession:undefined;
    if(session){session.allowed=true;session.failed.delete(id);}
  };
  const cancelLoading=async(e:PlaybackEngine,signal:AbortSignal)=>{
    if(e.chartSession)e.chartSession.allowed=false;
    if(e.batchSession)e.batchSession.allowed=false;
    e.advanceFailure=undefined;
    if(e.queue.snapshot.loading)await e.player.stop();
    signal.throwIfAborted();
  };
  const deferredItem=(e:NonNullable<typeof engine.current>,t:Track,id=queueId(),ready=false):QueueItem=>{
    e.tracks.set(id,{...t,resourceId:id});e.created.set(id,operation.current?.signal);
    let firstEntry=ready?t:undefined;
    const resourceId='queue:'+id;
    return {id,title:t.title,artist:t.artists?.join(', ')??t.uploader?.name,artwork:t.artwork?[{src:t.artwork}]:undefined,source:{resourceId,resolveTimeoutSeconds:60,prepare:ctx=>preparingRecord(e,id,ctx.signal,async()=>{
      if(e.batchSession?.allowed&&e.batchSession.failed.has(id))throw {code:'not-found'};
      const current=e.tracks.get(id)??t,songSelection=e.staged?.id===id?e.staged.track.selection:current.selection;
      if(e.staged?.id===id||songSelection?.kind==='song'||desktopSurface()&&songSelection?.kind==='source'&&key(songSelection.ref)!==key(t.ref)){firstEntry=undefined;return prepareSongQueueSource(e,current,songSelection!,resourceId,ctx.signal);}
      const entry=(desktopSurface()?e.prefetch?.take(id,warm=>prefetchedRef(t.ref,warm.ref)):undefined)??firstEntry??await readMetadata(t.ref,{signal:ctx.signal});firstEntry=undefined;ctx.signal.throwIfAborted();
      const source=await e.bridge.sourceFrom(entry,{signal:ctx.signal}),plan=await source.prepare(ctx);
      // A video's default part may become canonical only now. Keep the declared
      // player resource stable and map refresh/recovery to the bridge's real source.
      if(ctx.signal.aborted||blocked({...entry,resourceId:id})){e.player.sourceController.releaseUnusedPlan(plan);ctx.signal.throwIfAborted();throw {code:'source-disabled'};}
      e.tracks.set(id,{...t,...entry,resourceId:id});e.aliases.set(resourceId,source.resourceId);e.committed.set(resourceId,entry.ref);return {...plan,resourceId};
    })}};
  };
  const item=async(e:NonNullable<typeof engine.current>,t:Track,signal:AbortSignal,id=queueId(),ready=false):Promise<QueueItem>=>{
    const metadata=ready?t:await readMetadata(t.ref,{signal});signal.throwIfAborted();
    const entry=metadata.ref.provider==='bilibili'&&!metadata.ref.part?metadata.parts?.[0]??metadata:metadata;
    const track={...t,...entry,ref:entry.ref};
    return deferredItem(e,track,id,true);
  };
  const batchItems=async(e:NonNullable<typeof engine.current>,list:Track[],signal:AbortSignal)=>{
    if(!list.length||list.length>500)throw {code:'invalid-input'};
    const entries=[...list],allowed=list.flatMap((track,index)=>blocked(track)?[]:[{ref:track.ref,index}]);
    // The public resolver bounds source reads and reuses one snapshot per video,
    // while retaining explicit parts, input order and duplicate queue occurrences.
    if(allowed.length){
      const resolved=await resolveMusicEntries({metadata:readMetadata},allowed.map(item=>item.ref),{signal});
      allowed.forEach(({index},at)=>{entries[index]=resolved[at];});
    }
    signal.throwIfAborted();
    return entries.map((entry,index):QueueItem=>{
      const id=queueId(),track={...list[index],...entry,resourceId:id};e.tracks.set(id,track);
      return deferredItem(e,track,id);
    });
  };
  const playSingle=async(e:PlaybackEngine,t:Track,s:AbortSignal,ready=false)=>{
    await cancelLoading(e,s);
    const selected=await item(e,t,s,queueId(),ready);s.throwIfAborted();
    const resolved=e.tracks.get(selected.id)! as Track,q=e.queue.snapshot;
    const matches=q.items.filter(candidate=>{const track=e.tracks.get(candidate.id);return track&&isTrack(track)&&key(track.ref)===key(resolved.ref);});
    const existing=matches.find(candidate=>candidate.id===(q.current?.id??e.restored))??matches[0];
    const selection=existing&&(e.tracks.get(existing.id)?.chartItem||e.tracks.get(existing.id)?.selection)?{id:existing.id,track:resolved,signal:s}:undefined;
    if(existing)e.tracks.delete(selected.id);
    if(!existing){
      if(q.items.length>=500){e.tracks.delete(selected.id);throw {code:'queue-limit'};}
      if(q.current)e.queue.insertNext([selected]);
      else {const at=q.items.findIndex(candidate=>candidate.id===e.restored);e.queue.add([selected],at<0?0:at+1);}
    }
    // Keep lazy chart entries and their failure history when interrupting a chart.
    if(e.chartSession){e.chartSession.allowed=true;if(existing)e.chartSession.failed.delete(existing.id);}
    resumeBatchItem(e,existing?.id??selected.id);
    // Explicit playback uses the chosen reference for this selection only.
    // Later chart selections still resolve against the latest preferences.
    if(selection)e.chartSelection=selection;
    try{s.throwIfAborted();return await e.queue.selectId(existing?.id??selected.id,{restart:true});}
    finally{if(e.chartSelection===selection)e.chartSelection=undefined;}
  };
  const readPosition=useCallback(()=>engine.current?.player.currentTime??0,[]);
  return {snapshot,clock,readPosition,sleep,sleepTimer,audioAnalysis,error,preparing,chartFailures,chartSearchTitle,chartSearchSong,diagnostics:playbackDiagnostics,
    playSelection,
    playSelections:(items:{selection:SongPlaybackSelection;song:Pick<Song,'title'|'artists'|'artwork'>}[])=>run(async(e,signal)=>{
      if(!items.length||items.length>500)throw {code:'queue-limit'};
      const tracks=items.map(item=>selectionTrack(item.selection,item.song)),first=tracks.findIndex(track=>!blocked(track));
      if(first<0)throw {code:'source-disabled'};
      const queue=tracks.map((track,index)=>songQueueItem(e,track,items[index].selection));signal.throwIfAborted();normalQueue(e);
      const replaced=await e.queue.replaceItems(queue);if(desktopSurface()&&!replaced)return false;signal.throwIfAborted();if(items.every(item=>item.selection.kind==='chart')){e.queue.setOrder('sequential');e.queue.setRepeat('off');e.chartSession={failed:new Set(),handled:new Set(),allowed:true};}return e.queue.select(first,{restart:true});
    }),
    updateSongs:(songs:Song[],versions:SongVersion[]=[],catalogLinks:SongCatalogLink[]=[],redirects:SongLibrarySnapshot['redirects']=[])=>{libraryChoices.current={songs,versions,catalogLinks};const e=engine.current;if(!e)return;
      e.prefetch?.reset();
      const destinations=new Map(redirects.map(redirect=>[redirect.from,redirect.to]));
      const redirectedSong=(id:string)=>{const seen=new Set<string>();while(destinations.has(id)&&!seen.has(id)){seen.add(id);id=destinations.get(id)!;}return songs.some(song=>song.id===id)?id:undefined;};
      for(const [id,track]of e.tracks){
      const owned=isTrack(track)?versions.find(version=>key(version.ref)===key(track.ref)):undefined;
      const originalSelection=track.selection;let selection=originalSelection;
      if((originalSelection?.kind==='song'||originalSelection?.kind==='source')&&originalSelection.songId&&!songs.some(song=>song.id===originalSelection.songId)){
        const songId=redirectedSong(originalSelection.songId)??owned?.songId;if(songId)selection={...originalSelection,songId};
      }
      const selectedSongId=selection?.kind==='song'||selection?.kind==='source'?selection.songId:undefined;
      const songId=selection?.kind==='song'?selectedSongId:owned?.songId??selectedSongId??(isTrack(track)&&track.songId?redirectedSong(track.songId)??track.songId:undefined),song=songs.find(song=>song.id===songId);
      if(song){
        const desktop=!!desktopSongSearchOptions().searchMode;
        const sourceArtwork=isTrack(track)?track.sourceArtwork!==undefined?track.sourceArtwork:track.artwork??null:null;
        const sourceTitle=isTrack(track)?track.sourceTitle??owned?.facts.title??(!track.songId?track.title:undefined):undefined;
        // A previous desktop cover is presentation, never a fallback for a cleared projection.
        const artwork=desktop||isTrack(track)&&track.sourceArtwork!==undefined?song.artwork??sourceArtwork??undefined:song.artwork??track.artwork;
        e.tracks.set(id,{...track,...(selection?{selection}:{}),...(isTrack(track)?{songId:song.id,...(owned?{versionId:owned.id}:{}),...(desktop?{sourceArtwork,sourceTitle}:{})}:{}),title:song.title,artists:song.artists,artwork});
      }
    }e.system.updateMetadata();e.sync?.();},
    cancelPending:()=>{operation.current?.abort();const e=engine.current;if(e){e.prefetch?.foreground();e.recovery.cancelEnvironment();e.intent++;if(e.chartSession)e.chartSession.allowed=false;if(e.batchSession)e.batchSession.allowed=false;e.advanceFailure=undefined;if(e.queue.snapshot.loading)void e.player.stop().catch(()=>{});}},
    currentTrackId:()=>engine.current?.queue.snapshot.current?.id,
    expandParts:(anchorId:string,list:Track[])=>{
      const e=engine.current;if(!e||e.releasing||e.queue.snapshot.current?.id!==anchorId||!e.queue.snapshot.loaded)return false;
      try {
        const tracks=e.queue.snapshot.items.map(item=>e.tracks.get(item.id)!);
        const plan=planPartExpansion(tracks,anchorId,list,queueId);
        const additions=plan.additions.map(track=>deferredItem(e,track,track.resourceId));
        for(const track of plan.group)e.tracks.set(track.resourceId,track);
        // All validation is complete. These edits are synchronous and never reload the selected source.
        if(additions.length)e.queue.add(additions);
        plan.items.forEach((track,index)=>{if(e.queue.snapshot.items[index]?.id!==track.resourceId)e.queue.move(track.resourceId,index);});
        e.queue.setOrder('sequential');e.queue.setRepeat('off');e.sync?.();setError('');return true;
      }catch(issue){if(!cancelled(issue))setError(errorText(issue));return false;}
    },
    playChartItem:(chartItem:ChartItem)=>run(async(e,s)=>{
      try {
        await cancelLoading(e,s);
        const track=await resolveChartResult(chartItem,s,e.bridge.audioSupport);s.throwIfAborted();return await playSingle(e,track,s);
      } catch(issue) {if(!s.aborted&&!cancelled(issue)){setChartSearchTitle(chartItem.title);setChartSearchSong(chartItem);setError(errorText(issue));}throw issue;}
    }),
    playChart:(list:ChartItem[])=>run(async(e,s)=>{
      if(!list.length)throw {code:'invalid-input'};if(list.length>500)throw {code:'queue-limit'};
      await cancelLoading(e,s);
      const items=list.map(t=>chartQueueItem(e,pendingChartTrack(t,queueId())));s.throwIfAborted();normalQueue(e);
      if(!await e.queue.replaceItems(items))return;s.throwIfAborted();e.queue.setOrder('sequential');e.queue.setRepeat('off');
      e.chartSession={failed:new Set(),handled:new Set(),allowed:true};await e.queue.select(0,{restart:true});
    }),
    play:(t:Track,_context?:{tracks:Track[];index:number},ready=false,deadline?:number)=>run((e,s)=>playSingle(e,t,s,ready),true,deadline),
    add:(t:Track,ready=false)=>run(async(e,s)=>{if(e.queue.snapshot.items.length>=500)throw {code:'queue-limit'};const added=await item(e,t,s,queueId(),ready);s.throwIfAborted();e.queue.add([added]);}),
    playAll:(list:Track[])=>run(async(e,s)=>{if(list.length>500)throw {code:'queue-limit'};if(!list.some(t=>!blocked(t)))throw {code:'source-disabled'};await cancelLoading(e,s);const desktop=desktopSurface(),items=desktop?list.map(track=>deferredItem(e,track)):await batchItems(e,list,s);s.throwIfAborted();normalQueue(e);if(!await e.queue.replaceItems(items))return false;s.throwIfAborted();if(desktop)e.batchSession={failed:new Set(),handled:new Set(),allowed:true};return e.queue.select(list.findIndex(t=>!blocked(t)),{restart:true});}),
    addAll:(list:Track[])=>run(async(e,s)=>{if(e.queue.snapshot.items.length+list.length>500)throw {code:'queue-limit'};const items=await batchItems(e,list,s);s.throwIfAborted();e.queue.add(items);}),
    select:(id:string)=>run(e=>{resumeChart(e);e.chartSession?.failed.delete(id);resumeBatchItem(e,id);return e.queue.selectId(id,{restart:true});}),
    toggle:()=>{const e=engine.current;if(e?.recovery.preparing){if(e.player.playbackRequested)e.player.pause();else e.player.requestPlayback();return Promise.resolve(true);}return run(e=>{if(!e.player.paused)e.player.pause();else {resumeChart(e);const track=e.tracks.get(e.queue.snapshot.current?.id??e.restored??'');if(track&&blocked(track))return advancePlayable(e,1);if(e.restored)return e.queue.selectId(e.restored,{restart:true});return e.queue.play();}},false);},
    retry:()=>run((e,signal)=>{resumeChart(e);const track=e.tracks.get(e.queue.snapshot.current?.id??'');return track&&blocked(track)?advancePlayable(e,1):e.recovery.retry(signal)??e.queue.retry();}), next:()=>run(e=>{resumeChart(e);return enabled.current?e.queue.next():advancePlayable(e,1);}), previous:()=>run(e=>{resumeChart(e);return enabled.current?e.queue.previous():advancePlayable(e,-1);}),
    seek:(n:number)=>run(e=>e.player.seekAsync(n),false),
    volume:(n:number)=>{controlsEpoch.current++;engine.current?.player.setVolume(n);},
    // Native ratechange can be suppressed before a source is loaded; still reflect and save the preference.
    rate:(value:number)=>{controlsEpoch.current++;const e=engine.current;if(e){e.player.setPlaybackRate(value);e.sync?.();}},
    mute:()=>{controlsEpoch.current++;const e=engine.current;if(e)e.player.setMuted(!e.player.muted);},
    skip:(delta:number)=>run(e=>e.player.seekAsync(Math.max(0,e.player.currentTime+delta)),false),
    startSleep:(rule:SleepTimerRule)=>engine.current?.sleep.start(rule),
    cancelSleep:()=>engine.current?.sleep.cancel(),
    remove:(id:string)=>run(e=>e.queue.remove(id),false),move:(id:string,to:number)=>engine.current?.queue.move(id,to),clear:()=>run(e=>{normalQueue(e);return e.queue.clear();},false),
    cycleMode:()=>{const e=engine.current;if(!e)return;const {order,repeat}=e.queue.snapshot;
      // Clear the previous mode before enabling its successor, including during persistence.
      if(order==='shuffle'){e.queue.setOrder('sequential');e.queue.setRepeat('all');}
      else if(repeat==='all')e.queue.setRepeat('one');
      else if(repeat==='one')e.queue.setRepeat('off');
      else {e.queue.setRepeat('off');e.queue.setOrder('shuffle');}
    },
    cancel:()=>{const switching=!!versionPreparing.current&&versionPreparing.current===operation.current?.signal;operation.current?.abort();const e=engine.current;if(e){e.intent++;if(e.chartSession)e.chartSession.allowed=false;if(!switching){e.player.pause();void e.player.stop().catch(issue=>setError(errorText(issue)));}}setPreparing(false);},
    stop:()=>run(e=>{if(e.chartSession)e.chartSession.allowed=false;return e.player.stop();},false),
    reset:()=>run(e=>{if(e.chartSession)e.chartSession.allowed=false;return e.player.stopAndReset();},false),
    sourceChanged:()=>{if(desktopSurface()){const e=engine.current;e?.prefetch?.reset();e?.recovery.cancelEnvironment();}},
    records:()=>{const e=engine.current;return {tracks:e?.tracks.size??0,aliases:e?.aliases.size??0,committed:e?.committed.size??0,preparing:e?.pendingRecords.size??0,prefetch:e?.prefetch?.size??0};},
    release:async()=>{operation.current?.abort();const e=engine.current;if(!e)return;e.releasing=true;e.prefetch?.cancel();e.recovery.dispose();e.queue.destroy();e.system.destroy();e.sleep.destroy();try{await e.player.destroyAsync();}finally{e.tracks.clear();e.aliases.clear();e.committed.clear();analysisRef.current?.dispose();try{await e.bridge.dispose();}catch(err){setError(errorText(err));}}},
    dismiss:()=>{setError('');setChartSearchTitle('');},dismissChartFailures:()=>setChartFailures([])
  };
}
