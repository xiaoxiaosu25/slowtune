import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';

// Exercise the product hook with the fixed, real QueueController. Only React,
// media and source I/O are replaced, so cancellation races are deterministic.
const contextKey=Symbol.for('music-app:chart-playback-test');
const playbackUrl=process.env.SLOWTUNE_COMPARE_SOURCE??new URL('../src/playback.ts',import.meta.url).href;
const mockUrl='data:text/javascript,'+encodeURIComponent(`
  const context=()=>globalThis[Symbol.for('music-app:chart-playback-test')];
  export const useRef=value=>context().useRef(value);
  export const useState=value=>context().useState(value);
  export const useEffect=fn=>context().useEffect(fn);
  export const useCallback=fn=>fn;
  export class StudioPlayer {constructor(){return context().player;}}
  export class MusicPlayerBridge {constructor(){return context().bridge;}}
  export class BestAudioBridge {constructor(){return context().bridge;}}
  export {retainVerifiedAudio} from ${JSON.stringify(new URL('../src/audio-quality.ts',import.meta.url).href)};
  export class PlaybackAudioAnalysis {dispose(){}}
  export class MediaSessionController {activate(){} updateMetadata(){} destroy(){}}
  export class SleepTimerController extends EventTarget {
    snapshot={status:'idle'}; destroy(){} start(){} cancel(){}
  }
`);
const mocks=new Set(['react','@studio/player/core','@studio/player/media-session','@studio/player/sleep-timer','@studio/music-sources/player','./audio-quality','./audio-analysis']);
const apiMockUrl='data:text/javascript,'+encodeURIComponent(`
  export {cancelled,errorText,key} from ${JSON.stringify(new URL('../src/api.ts',import.meta.url).href)};
  export const request=(...args)=>globalThis[Symbol.for('music-app:chart-playback-test')].request(...args);
`);
const hooks=registerHooks({
  resolve(specifier,context,nextResolve){
    if(context.parentURL?.includes('/baseline-src/')&&specifier.startsWith('../server/'))return {url:new URL(specifier.replace('../server/','../baseline-server/')+'.ts',context.parentURL).href,shortCircuit:true};
    if(context.parentURL===playbackUrl&&specifier==='./api')return {url:apiMockUrl,shortCircuit:true};
    if(context.parentURL===playbackUrl&&mocks.has(specifier))return {url:mockUrl,shortCircuit:true};
    if(context.parentURL===playbackUrl&&['./api','./chart-playback','./multipart'].includes(specifier))return {url:new URL(specifier+'.ts',playbackUrl).href,shortCircuit:true};
    if(context.parentURL?.endsWith('.ts')&&specifier.startsWith('.')&&!specifier.endsWith('.ts'))return {url:new URL(specifier.endsWith('.js')?specifier.slice(0,-3)+'.ts':specifier+'.ts',context.parentURL).href,shortCircuit:true};
    return nextResolve(specifier,context);
  },
  load(url,context,nextLoad){
    if(url.startsWith(new URL('..',import.meta.url).href)&&url.endsWith('.ts'))return {format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};
    return nextLoad(url,context);
  }
});
const {usePlayback}=await import(playbackUrl);
hooks.deregister();

class Media {
  sourceController={releaseUnusedPlan(){},cancelSourcePreparation:()=>this.controller?.abort()};
  state='idle';paused=true;failed=false;playbackRequested=false;isDestroyed=false;
  volume=.5;playbackRate=1;muted=false;buffered=[];currentTime=0;duration=20;
  events=new Map();
  on(name,fn){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(fn);return ()=>this.events.get(name).delete(fn);}
  emit(name,...args){for(const fn of this.events.get(name)??[])fn(...args);}
  attach(){} setVolume(value){this.volume=value;} setPlaybackRate(value){this.playbackRate=value;} setMuted(value){this.muted=value;}
  requestPlayback(){this.playbackRequested=true;return true;}
  async load(source){
    this.controller?.abort();const controller=this.controller=new AbortController();
    this.failed=false;this.state='loading';this.paused=true;this.emit('loadstart');
    try {const plan=await source.prepare({signal:controller.signal});controller.signal.throwIfAborted();this.currentResourceId=source.resourceId;this.currentPlan=plan;this.currentMetadata=plan.metadata??null;this.state='ready';}
    catch(error){if(!controller.signal.aborted)this.fail(error);throw error;}
  }
  async play(){this.state='playing';this.paused=false;this.playbackRequested=true;this.emit('play');this.emit('playing');}
  pause(){this.paused=true;this.playbackRequested=false;this.emit('pauseintent');this.emit('pause');}
  async stop(){this.controller?.abort();this.paused=true;this.playbackRequested=false;this.state='stopped';this.emit('stop');}
  async stopAndReset(){await this.stop();this.currentTime=0;}
  async destroyAsync(){this.isDestroyed=true;this.controller?.abort();}
  finish(){this.paused=true;this.playbackRequested=false;this.state='ended';this.emit('ended',{resourceId:this.currentResourceId});}
  fail(error){this.failed=true;this.paused=true;this.playbackRequested=false;this.state='error';this.emit('error',error,false);}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(condition){for(let i=0;i<100;i++){if(condition())return;await tick();}assert.fail('playback did not reach the expected state');}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const chart=titles=>titles.map((title,i)=>({rank:i+1,title}));
const batchTracks=titles=>titles.map((title,index)=>({ref:{provider:title==='youtube'?'youtube':'bilibili',kind:'video',id:title==='youtube'?'kK0CRZ0wvvc':'BV'+String(index+1).padStart(10,'0'),...(title==='youtube'?{}:{part:'1'})},resourceId:title,title,url:'https://example.com'}));
function harness(t,search,savedPlayback,desktop=false){
  const player=new Media(),calls=[],played=[],states=[],refs=[],effects=[];let stateAt=0,refAt=0,mounted=false;
  const entries=new Map(),resolved=new Map();
  const client={
    search:async(provider,request,{signal})=>{
      calls.push(request.query);const result=await search(request.query,signal);
      if(result!==undefined)return result;
      const entry={ref:{provider,kind:'video',id:request.query},resourceId:request.query,title:request.query};entries.set(entry.ref.id,entry);return {items:[entry]};
    },
    metadata:async ref=>entries.get(ref.id),capabilities:()=>({operations:[]})
  };
  const bridge={resolver:{},source:async ref=>({resourceId:ref.id,prepare:async()=>({})}),dispose:async()=>{}};
  bridge.sourceFrom=(entry,options)=>bridge.source(entry.ref,options);
  const values=new Map();
  if(savedPlayback)values.set('slow-listening:playback:v3',JSON.stringify(savedPlayback));
  const previous=new Map(['document','window','localStorage'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  Object.assign(globalThis,{document:Object.assign(new EventTarget(),{createElement:()=>Object.assign(new EventTarget(),{dataset:{},remove(){}}),body:{append(){}}}),window:Object.assign(new EventTarget(),{matchMedia:()=>({matches:desktop})}),localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}});
  globalThis[contextKey]={player,bridge,
    async request(path,song,signal){assert.equal(path,'/api/search/resolve');if(resolved.has(song.title))return {entry:resolved.get(song.title)};const page=await client.search('bilibili',{query:song.title,mode:'video',limit:20},{signal});signal.throwIfAborted();if(!page.items.length)throw {code:'no-match'};resolved.set(song.title,page.items[0]);return {entry:page.items[0]};},
    useRef(value){return refs[refAt++]??(refs[refAt-1]={current:value});},
    useState(value){const at=stateAt++;if(!(at in states))states[at]=value;return [states[at],value=>states[at]=typeof value==='function'?value(states[at]):value];},
    useEffect(fn){if(!mounted)effects.push(fn);}
  };
  let sourceEnabled=false;
  const render=(enabled=sourceEnabled)=>{sourceEnabled=enabled;stateAt=refAt=0;const result=usePlayback(client,false,undefined,sourceEnabled);if(!mounted){mounted=true;for(const effect of effects)effects[effects.indexOf(effect)]=effect();}return result;};
  const engine=()=>refs.find(ref=>ref.current?.queue)?.current;
  player.on('playing',()=>played.push(engine().queue.snapshot.current.title));
  const api=render();
  t.after(async()=>{for(const cleanup of effects)cleanup?.();await tick();delete globalThis[contextKey];for(const [name,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
  return {api,render,player,client,bridge,calls,played,get queue(){return engine().queue;},records:()=>{const e=engine();return {tracks:e.tracks.size,aliases:e.aliases.size,committed:e.committed.size};}};
}

if(process.env.SLOWTUNE_COMPARE_OUTPUT)test('controlled continuity comparison',async t=>{
  const h=harness(t,async()=>undefined,undefined,true),tracks=batchTracks(Array.from({length:30},(_,index)=>'track-'+index)),samples=[];let reads=0;
  h.client.metadata=async ref=>{reads++;await new Promise(resolve=>setTimeout(resolve,4));return tracks.find(track=>track.ref.id===ref.id);};
  for(let sample=0;sample<10;sample++){const start=performance.now(),before=reads;await h.api.playAll(tracks);samples.push({ms:performance.now()-start,metadataReads:reads-before});}
  const retained=h.records();await h.api.clear();
  writeFileSync(process.env.SLOWTUNE_COMPARE_OUTPUT,JSON.stringify({samples,retainedAfterTenReplacements:retained,afterClear:h.records()},null,2));
});

test('saved song selections prepare fresh audio without a preliminary metadata request, re-read defaults and update names without reloading audio',async t=>{
  const h=harness(t,async()=>undefined),song={id:'song',title:'标准歌名',artists:['歌手']};let selected='900',reads=0;
  const versions=['900','901'].map(id=>({id,songId:song.id,ref:{provider:'bilibili',kind:'video',id:'BV1tX4y1W7Xm',part:id},facts:{title:'来源 '+id}}));
  h.api.updateSongs([{...song,defaultVersionId:selected}],versions);
  h.client.metadata=async ref=>{reads++;return {ref,resourceId:'source-'+ref.part,title:'来源 '+ref.part,url:'https://example.com'};};
  globalThis[contextKey].request=async()=>assert.fail('a selected song source uses the local index, without another playback HTTP lookup');
  await h.api.playSelections([{selection:{kind:'song',songId:'song'},song},{selection:{kind:'song',songId:'song'},song}]);
  const ids=h.queue.snapshot.items.map(item=>item.id);assert.equal(new Set(ids).size,2);assert.equal(h.render().snapshot.current.ref.part,'900');
  selected='901';h.api.updateSongs([{...song,defaultVersionId:selected}],versions);await h.api.select(ids[1]);assert.equal(h.render().snapshot.current.ref.part,'901');
  h.player.currentTime=7;let loads=0;h.player.on('loadstart',()=>loads++);h.api.updateSongs([{...song,title:'人工修改',defaultVersionId:selected}],versions);
  assert.equal(loads,0);assert.equal(h.player.currentTime,7);assert.equal(h.render().snapshot.current.title,'人工修改');
  await h.api.playSelection({kind:'song',songId:'song',explicitVersionId:'900'},song);assert.equal(h.queue.snapshot.current.id,ids[1]);assert.equal(h.render().snapshot.current.ref.part,'900');assert.deepEqual(h.queue.snapshot.items.map(item=>item.id),ids);
  assert.equal(reads,0,'exact saved versions go straight to fresh source preparation');
});
test('media clock updates retain queue objects and never rewrite browser playback storage',async t=>{
  const h=harness(t,async()=>undefined),track=batchTracks(['A'])[0];h.client.metadata=async()=>track;
  await h.api.playAll(Array.from({length:500},()=>track));
  const before=h.render().snapshot,writes=[];
  const save=localStorage.setItem;localStorage.setItem=(...args)=>{writes.push(args);return save(...args);};
  for(let i=1;i<=40;i++){h.player.currentTime=i/4;h.player.emit('timeupdate',i/4);}
  const after=h.render().snapshot;
  assert.equal(after.position,10);assert.equal(after.items,before.items);assert.equal(after.current,before.current);assert.equal(writes.length,0);
  h.api.rate(1.5);assert.equal(JSON.parse(writes.at(-1)[1]).rate,1.5,'control changes are still saved immediately');
});

test('desktop play-all starts with first metadata only, preserves duplicate order, and skips a failed later item',async t=>{
  const h=harness(t,async()=>undefined,undefined,true),tracks=batchTracks(['A','B','C']),reads=[];
  h.client.metadata=async ref=>{reads.push(ref.id);if(ref.id===tracks[1].ref.id)throw {code:'not-found'};return tracks.find(track=>track.ref.id===ref.id);};
  assert.equal(await h.api.playAll([tracks[0],tracks[1],tracks[0],tracks[2]]),true);
  assert.deepEqual(reads,[tracks[0].ref.id]);
  assert.deepEqual(h.queue.snapshot.items.map(item=>item.title),['A','B','A','C']);
  await h.api.next();await until(()=>h.played.length===2);
  assert.deepEqual(h.played,['A','A']);assert.equal(h.render().chartFailures.length,1);
  await h.api.next();assert.deepEqual(h.played,['A','A','C']);
});

for(const action of ['queue selection','direct track play','song selection'])test('desktop batch retries a recovered item through '+action+' and retains other failed items',async t=>{
  const h=harness(t,async()=>undefined,undefined,true),tracks=batchTracks(['A','B','C','D','E']),unavailable=new Set([tracks[1].ref.id,tracks[3].ref.id]),reads=[];
  h.render(true);
  h.client.metadata=async ref=>{reads.push(ref.id);if(unavailable.has(ref.id))throw {code:'not-found'};return tracks.find(track=>track.ref.id===ref.id);};
  await h.api.playAll(tracks);const ids=h.queue.snapshot.items.map(item=>item.id);
  await h.api.next();await until(()=>h.played.at(-1)==='C');
  await h.api.next();await until(()=>h.played.at(-1)==='E');
  assert.equal(h.render().chartFailures.length,2);unavailable.clear();
  const before=reads.filter(id=>id===tracks[1].ref.id).length;
  const retried=await(action==='queue selection'?h.api.select(ids[1]):action==='direct track play'?h.api.play(tracks[1]):h.api.playSelection({kind:'source',ref:tracks[1].ref},tracks[1]));
  assert.equal(retried,true);assert.equal(h.queue.snapshot.current.id,ids[1]);assert.equal(h.played.at(-1),'B');
  assert(reads.filter(id=>id===tracks[1].ref.id).length>before,'explicit playback requests the recovered source again');
  assert.deepEqual(h.queue.snapshot.items.map(item=>item.id),ids);
  h.player.finish();await until(()=>h.played.at(-1)==='C');
  h.player.finish();await until(()=>h.played.at(-1)==='E');
  assert.equal(reads.filter(id=>id===tracks[3].ref.id).length,1,'automatic advancement retains unrelated failure markers');
});

test('desktop queue replacements and clearing reclaim records while preserving current playback and repeated occurrences',async t=>{
  const h=harness(t,async()=>undefined,undefined,true),tracks=batchTracks(['A','B','C']);
  h.client.metadata=async ref=>tracks.find(track=>track.ref.id===ref.id);
  for(let i=0;i<20;i++){
    await h.api.playAll(tracks);await h.api.next();
    assert.equal(h.api.records().tracks,3);assert.equal(h.api.records().committed,2);
    await h.api.remove(h.queue.snapshot.items[0].id);
    assert.equal(h.api.records().tracks,2);assert.equal(h.api.records().committed,1);
    assert.equal(h.render().snapshot.current.title,'B');
  }
  await h.api.clear();assert.deepEqual(h.api.records(),{tracks:0,aliases:0,committed:0,preparing:0,prefetch:0});
});

test('desktop cancelled preparations cannot repopulate removed records or overwrite a newer queue',async t=>{
  const h=harness(t,async()=>undefined,undefined,true),tracks=batchTracks(['A','B']),held=deferred(),entered=deferred(),released=[];
  h.client.metadata=async ref=>tracks.find(track=>track.ref.id===ref.id);
  h.player.sourceController.releaseUnusedPlan=plan=>released.push(plan);
  h.bridge.source=async ref=>({resourceId:ref.id,prepare:async()=>{if(ref.id===tracks[0].ref.id){entered.resolve();await held.promise;}return {metadata:{title:ref.id}};}});
  const old=h.api.playAll([tracks[0]]);await entered.promise;
  assert.equal(await h.api.playAll([tracks[1]]),true);held.resolve();await old;
  assert.deepEqual(h.queue.snapshot.items.map(item=>item.title),['B']);
  assert.equal(h.render().snapshot.current.title,'B');assert.equal(released.length,1);
  assert.deepEqual(h.api.records(),{tracks:1,aliases:1,committed:1,preparing:0,prefetch:0});
});

test('desktop cancellation during first play-all metadata prevents late playback and skips no new queue',async t=>{
  const h=harness(t,async()=>undefined,undefined,true),tracks=batchTracks(['A','B']),held=deferred(),entered=deferred();
  h.client.metadata=async ref=>{if(ref.id===tracks[0].ref.id){entered.resolve();await held.promise;}return tracks.find(track=>track.ref.id===ref.id);};
  const old=h.api.playAll(tracks);await entered.promise;h.api.cancelPending();held.resolve();await old;await tick();
  assert.deepEqual(h.played,[]);assert.equal(h.api.records().preparing,0);assert.equal(h.queue.snapshot.items.length,2);
});

test('desktop restored entries survive unrelated removal and are released once removed themselves',async t=>{
  const tracks=batchTracks(['A','B']),saved={version:3,items:tracks.map((track,index)=>({instanceId:'saved-'+index,selection:{kind:'source',ref:track.ref},title:track.title})),current:'saved-0',order:'sequential',repeat:'off',volume:.5,rate:1,muted:false};
  const h=harness(t,async()=>undefined,saved,true);
  await h.api.remove('saved-1');assert.equal(h.render().snapshot.currentId,'saved-0');assert.equal(h.api.records().tracks,1);
  await h.api.remove('saved-0');assert.equal(h.render().snapshot.currentId,undefined);assert.equal(h.api.records().tracks,0);
});
for(const mode of ['sequential','shuffle','all','one'])test('song point playback inserts after current and reuses existing occurrences in '+mode,async t=>{
  const h=harness(t,async()=>undefined),tracks=batchTracks(['A','B','X']);
  const songs=tracks.map((track,index)=>({id:track.title,title:track.title,defaultVersionId:'v'+index}));
  h.client.metadata=async ref=>tracks.find(track=>track.ref.id===ref.id);
  h.api.updateSongs(songs,tracks.map((track,index)=>({id:'v'+index,songId:track.title,ref:track.ref})));
  const selection=song=>({selection:{kind:'song',songId:song.id},song});
  await h.api.playSelections(songs.slice(0,2).map(selection));const original=h.queue.snapshot.items.map(item=>item.id);
  if(mode==='shuffle')h.queue.setOrder(mode);else if(mode!=='sequential')h.queue.setRepeat(mode);
  await h.api.playSelection(selection(songs[2]).selection,songs[2]);
  const inserted=h.queue.snapshot.current.id;
  assert.deepEqual(h.queue.snapshot.items.map(item=>item.title),['A','X','B']);
  assert.deepEqual([h.queue.snapshot.items[0].id,h.queue.snapshot.items[2].id],original);
  assert.equal(mode==='shuffle'?h.queue.snapshot.order:h.queue.snapshot.repeat,mode==='sequential'?'off':mode);
  if(mode==='sequential'){h.player.finish();await until(()=>h.played.at(-1)==='B');}
  await h.api.playSelection(selection(songs[0]).selection,songs[0]);
  assert.equal(h.queue.snapshot.current.id,original[0]);assert.deepEqual(h.queue.snapshot.items.map(item=>item.id),[original[0],inserted,original[1]]);
});
test('point playback reuses the matching pinned occurrence without changing other playlist members',async t=>{
  const h=harness(t,async()=>undefined),song={id:'song',title:'歌曲',defaultVersionId:'900'};
  const versions=['900','901'].map(part=>({id:part,songId:song.id,ref:{provider:'bilibili',kind:'video',id:'BV1tX4y1W7Xm',part}}));
  h.client.metadata=async ref=>({ref,resourceId:ref.part,title:'来源 '+ref.part});h.api.updateSongs([song],versions);
  const unpinned={kind:'song',songId:song.id},pinned={...unpinned,pinnedVersionId:'901'};
  await h.api.playSelections([{selection:unpinned,song},{selection:pinned,song},{selection:unpinned,song}]);
  const before=h.render().snapshot.items,ids=h.queue.snapshot.items.map(item=>item.id);
  await h.api.playSelection(pinned,song);assert.equal(h.queue.snapshot.current.id,ids[1]);assert.equal(h.render().snapshot.current.ref.part,'901');
  await h.api.playSelection(unpinned,song);assert.equal(h.queue.snapshot.current.id,ids[0]);assert.equal(h.render().snapshot.current.ref.part,'900');
  await h.api.select(ids[2]);await h.api.playSelection(unpinned,song);assert.equal(h.queue.snapshot.current.id,ids[2],'prefer the current occurrence among repeated members');
  assert.deepEqual(h.queue.snapshot.items.map(item=>item.id),ids);assert.deepEqual(h.render().snapshot.items.map(item=>item.selection),before.map(item=>item.selection));
});
test('point playback reuses a formerly disabled song with its newly prepared enabled version',async t=>{
  const h=harness(t,async()=>undefined),[youtube,bilibili]=batchTracks(['youtube','B']);
  const replacement={...bilibili,ref:{...bilibili.ref,id:'BV1234567891'},title:'新的 B站版本'};
  const songs=[{id:'A',title:'A',defaultVersionId:'youtube'},{id:'B',title:'B',defaultVersionId:'bilibili'}];
  const versions=[{id:'youtube',songId:'A',ref:youtube.ref,facts:{title:youtube.title}},{id:'bilibili',songId:'B',ref:bilibili.ref,facts:{title:bilibili.title}},{id:'replacement',songId:'A',ref:replacement.ref,facts:{title:replacement.title}}];
  h.client.metadata=async ref=>[youtube,bilibili,replacement].find(track=>track.ref.id===ref.id);
  h.render(true);h.api.updateSongs(songs,versions);
  await h.api.playSelections(songs.map(song=>({selection:{kind:'song',songId:song.id},song})));
  const ids=h.queue.snapshot.items.map(item=>item.id);
  await h.api.select(ids[1]);h.render(false);
  h.api.updateSongs([{...songs[0],defaultVersionId:'replacement'},songs[1]],versions);
  assert.equal(await h.api.playSelection({kind:'song',songId:'A'},songs[0]),true);
  assert.equal(h.queue.snapshot.current.id,ids[0]);assert.deepEqual(h.queue.snapshot.items.map(item=>item.id),ids);
  assert.deepEqual(h.render().snapshot.current.ref,replacement.ref);assert.equal(h.render().error,'');
  h.api.updateSongs(songs,versions);
  assert.equal(await h.api.playSelection({kind:'song',songId:'A'},songs[0]),false,'a newly selected disabled version is still rejected');
  assert.deepEqual(h.render().snapshot.current.ref,replacement.ref);
});
test('a full song queue permits replaying an existing member and rejects only new insertions',async t=>{
  const h=harness(t,async()=>undefined),tracks=batchTracks(['A','X']),songs=tracks.map((track,index)=>({id:track.title,title:track.title,defaultVersionId:'v'+index}));
  h.client.metadata=async ref=>tracks.find(track=>track.ref.id===ref.id);h.api.updateSongs(songs,tracks.map((track,index)=>({id:'v'+index,songId:track.title,ref:track.ref})));
  await h.api.playSelections(Array.from({length:500},()=>({selection:{kind:'song',songId:'A'},song:songs[0]})));
  const before=h.queue.snapshot.items,current=h.queue.snapshot.current.id;
  assert.equal(await h.api.playSelection({kind:'song',songId:'A'},songs[0]),true);assert.equal(h.queue.snapshot.current.id,current);assert.deepEqual(h.queue.snapshot.items,before);
  assert.equal(await h.api.playSelection({kind:'song',songId:'X'},songs[1]),false);assert.deepEqual(h.queue.snapshot.items,before);assert.match(h.render().error,/500/);
});
test('point playback inserts after a silently restored current item',async t=>{
  const tracks=batchTracks(['A','B','X']),saved={version:3,items:tracks.slice(0,2).map(track=>({instanceId:track.title,selection:{kind:'source',ref:track.ref},title:track.title})),current:'A',order:'sequential',repeat:'off'};
  const h=harness(t,async()=>undefined,saved),song={id:'X',title:'X',defaultVersionId:'version'};
  h.client.metadata=async ref=>tracks.find(track=>track.ref.id===ref.id);h.api.updateSongs([song],[{id:'version',songId:'X',ref:tracks[2].ref}]);
  assert.equal(h.queue.snapshot.current,null);assert.equal(h.player.state,'idle');assert.deepEqual(h.played,[]);
  await h.api.playSelection({kind:'song',songId:'X'},song);
  assert.deepEqual(h.queue.snapshot.items.map(item=>item.title),['A','X','B']);assert.equal(h.queue.snapshot.items[0].id,'A');assert.equal(h.queue.snapshot.items[2].id,'B');
  h.player.finish();await until(()=>h.render().snapshot.current?.title==='B'&&h.player.state==='playing');
});
for(const origin of ['source','chart'])test('resolved point playback reuses an existing '+origin+' queue item with one preparation',async t=>{
  const h=harness(t,async()=>undefined),track=batchTracks(['A'])[0];let preparations=0;
  h.client.metadata=async()=>track;globalThis[contextKey].request=async()=>({entry:track});
  h.bridge.source=async ref=>({resourceId:ref.id,prepare:async()=>{preparations++;return {};}});
  if(origin==='source')await h.api.play(track);else await h.api.playChart(chart(['A']));
  const id=h.queue.snapshot.current.id,resourceId=h.player.currentResourceId;
  await h.api.playSelection({kind:'query',query:{title:'A'}},{title:'A'});
  assert.equal(h.queue.snapshot.current.id,id);assert.equal(h.queue.snapshot.items.length,1);assert.equal(h.player.currentResourceId,resourceId);assert.equal(preparations,2,'the independently prepared point-play plan is consumed once');
});
test('saving and renaming a currently playing source adopts its exact song identity without another media load',async t=>{
  const h=harness(t,async()=>undefined),track=batchTracks(['来源'])[0];h.client.metadata=async()=>track;
  await h.api.play(track);const id=h.queue.snapshot.current.id;h.player.currentTime=8;let loads=0;h.player.on('loadstart',()=>loads++);
  h.api.updateSongs([{id:'song',title:'人工标准歌名',artists:['人工歌手']}],[{id:'version',songId:'song',ref:track.ref,facts:{title:track.title}}]);
  const current=h.render().snapshot.current;assert.equal(current.songId,'song');assert.equal(current.title,'人工标准歌名');assert.equal(loads,0);assert.equal(h.player.currentTime,8);assert.equal(h.queue.snapshot.current.id,id);
});
for(const origin of ['source','chart'])test('a grouped '+origin+' queue item commits another version with its original resource identity',async t=>{
  const h=harness(t,async()=>undefined),ref={provider:'bilibili',kind:'video',id:'BV1tX4y1W7Xm',part:'900'};
  const entry=ref=>({ref,resourceId:'source-'+ref.part,title:'来源 '+ref.part,url:'https://example.com'}),song={id:'song',title:'歌曲',defaultVersionId:'900'};
  h.client.metadata=async ref=>entry(ref);
  h.bridge.source=async ref=>({resourceId:ref.part,prepare:async()=>({metadata:{version:ref.part}})});
  const released=[];h.player.sourceController.releaseUnusedPlan=plan=>released.push(plan);
  if(origin==='source')await h.api.play(entry(ref));
  else {globalThis[contextKey].request=async()=>({entry:entry(ref)});await h.api.playChart(chart(['榜单歌曲']));}
  const id=h.queue.snapshot.current.id,resourceId=h.player.currentResourceId,history=[...h.queue.snapshot.history];
  h.api.updateSongs([song],['900','901'].map(id=>({id,songId:song.id,ref:{...ref,part:id},facts:{title:'来源 '+id}})));
  assert.equal(await h.api.playSelection({kind:'song',songId:song.id,explicitVersionId:'901'},song),true);
  assert.equal(h.player.currentPlan.metadata.version,'901','the committed media plan uses the selected version');
  assert.equal(h.player.currentPlan.resourceId,resourceId,'switching retains the declared player resource');
  assert.equal(h.render().snapshot.current.ref.part,'901');assert.equal(h.queue.snapshot.current.id,id);
  assert.deepEqual(h.queue.snapshot.items.map(item=>item.id),[id]);assert.deepEqual(h.queue.snapshot.history,history);assert.deepEqual(released,[]);
  await h.api.select(id);assert.equal(h.player.currentPlan.metadata.version,'901','reselecting retains the explicit version');
});
test('song merges redirect unresolved repeated queue items while retaining pins and instance IDs',async t=>{
  const h=harness(t,async()=>undefined),ref={provider:'bilibili',kind:'video',id:'BV1tX4y1W7Xm',part:'900'};
  const source={id:'source',title:'原歌曲',defaultVersionId:'900'},target={id:'target',title:'目标歌曲',defaultVersionId:'901'};
  const versions=[{id:'900',songId:source.id,ref,facts:{title:'来源'}},{id:'901',songId:target.id,ref:{...ref,part:'901'},facts:{title:'来源'}}];
  h.client.metadata=async ref=>({ref,resourceId:'source-'+ref.part,title:'来源',url:'https://example.com'});
  globalThis[contextKey].request=async()=>assert.fail('redirected queue selections resolve from the local index');
  h.api.updateSongs([source,target],versions);
  await h.api.playSelections([{selection:{kind:'song',songId:target.id},song:target},{selection:{kind:'song',songId:source.id},song:source},{selection:{kind:'song',songId:source.id,pinnedVersionId:'900'},song:source}]);
  const ids=h.queue.snapshot.items.map(item=>item.id);h.player.currentTime=8;let loads=0;h.player.on('loadstart',()=>loads++);
  h.api.updateSongs([target],versions.map(version=>({...version,songId:target.id})),[],[{from:source.id,to:'intermediate'},{from:'intermediate',to:target.id}]);
  assert.equal(loads,0);assert.equal(h.player.currentTime,8);assert.deepEqual(h.queue.snapshot.items.map(item=>item.id),ids);
  const items=h.render().snapshot.items;assert.equal(items[1].selection.songId,target.id);assert.equal(items[2].selection.songId,target.id);assert.equal(items[2].selection.pinnedVersionId,'900');
  assert.equal(await h.api.select(ids[1]),true);assert.equal(h.render().snapshot.current.ref.part,'901');
  assert.equal(await h.api.select(ids[2]),true);assert.equal(h.render().snapshot.current.ref.part,'900');
});
for(const action of ['cancel','pause'])test('pending song version '+action+' keeps the committed source and latest intent',async t=>{
  const h=harness(t,async()=>undefined),gate=deferred(),song={id:'song',title:'歌曲'};let started=false;
  globalThis[contextKey].request=async(_path,{selection})=>({song,versionId:selection.explicitVersionId??'900',entry:{ref:{provider:'bilibili',kind:'video',id:'BV1tX4y1W7Xm',part:selection.explicitVersionId??'900'},resourceId:'source',title:'来源',url:'https://example.com'}});
  h.bridge.source=async ref=>({resourceId:ref.part,prepare:async()=>{if(ref.part==='901'){started=true;await gate.promise;}return {};}});
  await h.api.playSelection({kind:'song',songId:'song'},song);const id=h.queue.snapshot.current.id;
  const pending=h.api.playSelection({kind:'song',songId:'song',explicitVersionId:'901'},song);await until(()=>started);
  if(action==='cancel')h.api.cancel();else await h.api.toggle();
  assert.equal(h.player.paused,action==='pause');gate.resolve();await pending;
  assert.equal(h.player.paused,action==='pause');assert.equal(h.queue.snapshot.current.id,id);assert.equal(h.render().snapshot.current.ref.part,'900');
});

for(const mode of ['sequential','shuffle','all','one'])test('disabled YouTube is retained and skipped without source reads in '+mode,async t=>{
  const h=harness(t,async()=>undefined),reads=[];
  const tracks=batchTracks(['first','youtube','last']);
  h.client.metadata=async ref=>{reads.push(ref.provider);return tracks.find(track=>track.ref.id===ref.id);};
  await h.api.playAll(tracks);assert.equal(h.queue.snapshot.items.length,3);assert.equal(h.queue.snapshot.current.title,'first');
  if(mode==='shuffle')h.queue.setOrder('shuffle');if(['all','one'].includes(mode))h.queue.setRepeat(mode);
  h.player.finish();await until(()=>h.played.length>=2);
  assert(h.played.every(title=>title!=='youtube'));assert(!reads.includes('youtube'));assert.equal(h.queue.snapshot.items.length,3);
  if(mode==='sequential'){assert.equal(h.queue.snapshot.current.title,'last');await h.api.previous();assert.equal(h.queue.snapshot.current.title,'first');}
});

test('pure disabled YouTube loop stops without repeated source reads and enables again with intact IDs',async t=>{
  const h=harness(t,async()=>undefined),reads=[];
  const track=batchTracks(['youtube'])[0];
  h.client.metadata=async ref=>{reads.push(ref.provider);return track;};
  h.render(true);await h.api.playAll([track]);const ids=h.queue.snapshot.items.map(item=>item.id);h.queue.setRepeat('all');
  h.render(false);const before=reads.length;h.player.finish();await until(()=>h.player.state==='stopped');
  assert.equal(reads.length,before);assert.deepEqual(h.queue.snapshot.items.map(item=>item.id),ids);
  h.render(true);await h.api.select(ids[0]);assert.equal(h.player.state,'playing');assert(reads.length>before);
});

test('disabled source leaves B站 completion alone and a mixed shuffle completes one finite pass',async t=>{
  const h=harness(t,async()=>undefined),tracks=batchTracks(['first','youtube','last']);
  h.client.metadata=async ref=>tracks.find(track=>track.ref.id===ref.id);
  await h.api.playAll([tracks[0]]);h.player.finish();await tick();assert.equal(h.player.state,'ended');assert.equal(h.render().error,'');
  await h.api.playAll(tracks);h.queue.setOrder('shuffle');const before=h.played.length;h.player.finish();await until(()=>h.played.length===before+1);h.player.finish();await tick();await tick();
  await until(()=>['ended','stopped'].includes(h.player.state));assert.equal(h.played.length,before+1);assert.equal(h.render().error,'');
});

test('play all and enqueue batches stay below the source metadata concurrency limit',async t=>{
  const h=harness(t,async()=>undefined),tracks=batchTracks(Array.from({length:7},(_,i)=>'Song '+i));let active=0,peak=0;
  h.client.metadata=async ref=>{
    active++;peak=Math.max(peak,active);
    try{if(active>4)throw {code:'busy'};await tick();return tracks.find(track=>track.ref.id===ref.id);}finally{active--;}
  };
  assert.equal(await h.api.playAll(tracks),true);assert.deepEqual(h.queue.snapshot.items.map(item=>item.title),tracks.map(track=>track.title));
  assert.equal(await h.api.addAll(tracks),true);assert.equal(h.queue.snapshot.items.length,14);assert(peak<=4);assert.equal(h.render().error,'');
});

test('batch metadata is reused across parts and keeps duplicate occurrences in input order',async t=>{
  const h=harness(t,async()=>undefined),video='BV0000000001',reads=[];
  const parts=[1,2,3,4,5].map(part=>({ref:{provider:'bilibili',kind:'video',id:video,part:String(part)},resourceId:'part-'+part,title:'Part '+part,url:'https://example.com'}));
  h.client.metadata=async ref=>{reads.push({...ref});return {...parts.find(part=>!ref.part||part.ref.part===ref.part),parts};};
  const list=[parts[4],parts[1],batchTracks(['youtube'])[0],parts[1],parts[0]];
  assert.equal(await h.api.addAll(list),true);assert.equal(reads.length,1);assert.deepEqual(h.render().snapshot.items.map(track=>track.ref.part),['5','2',undefined,'2','1']);
  assert.equal(new Set(h.queue.snapshot.items.map(item=>item.id)).size,list.length);
});

for(const mode of ['sequential','shuffle'])test('consecutive previous and forward navigation retain history with YouTube closed in '+mode,async t=>{
  const h=harness(t,async()=>undefined),tracks=batchTracks(['A','B','C']);h.client.metadata=async ref=>tracks.find(track=>track.ref.id===ref.id);
  await h.api.playAll(tracks);if(mode==='shuffle')h.queue.setOrder('shuffle');const ids=h.queue.snapshot.items.map(item=>item.id);
  await h.api.select(ids[1]);await h.api.select(ids[2]);const history=h.queue.snapshot.history;
  await h.api.previous();assert.equal(h.queue.snapshot.current.title,'B');await h.api.previous();assert.equal(h.queue.snapshot.current.title,'A');
  assert.deepEqual(h.queue.snapshot.history,history);assert.equal(h.queue.snapshot.historyIndex,0);
  await h.api.next();assert.equal(h.queue.snapshot.current.title,'B');await h.api.next();assert.equal(h.queue.snapshot.current.title,'C');assert.deepEqual(h.queue.snapshot.history,history);
});

test('history navigation skips disabled YouTube in both directions without reading it',async t=>{
  const h=harness(t,async()=>undefined),tracks=batchTracks(['A','youtube','C','D']),reads=[];h.render(true);
  h.client.metadata=async ref=>{reads.push(ref.provider);return tracks.find(track=>track.ref.id===ref.id);};
  await h.api.playAll(tracks);const ids=h.queue.snapshot.items.map(item=>item.id);for(const id of ids.slice(1))await h.api.select(id);
  h.render(false);reads.length=0;const history=h.queue.snapshot.history;
  await h.api.previous();assert.equal(h.queue.snapshot.current.title,'C');await h.api.previous();assert.equal(h.queue.snapshot.current.title,'A');
  await h.api.next();assert.equal(h.queue.snapshot.current.title,'C');await h.api.next();assert.equal(h.queue.snapshot.current.title,'D');
  assert.deepEqual(h.queue.snapshot.history,history);assert(!reads.includes('youtube'));assert.equal(h.render().error,'');
});

test('chart list repeat skips prior failures without searching again and allows manual retry',async t=>{
  let available=false;
  const h=harness(t,async title=>title==='失败歌曲'&&!available?{items:[]}:undefined);
  await h.api.playChart(chart(['失败歌曲','正常歌曲']));await until(()=>h.played.length===1);
  h.queue.setRepeat('all');h.player.finish();await until(()=>h.played.length===2);
  assert.deepEqual(h.calls,['失败歌曲','正常歌曲']);assert.deepEqual(h.played,['正常歌曲','正常歌曲']);assert.equal(h.render().chartFailures.length,1);
  available=true;await h.api.select(h.queue.snapshot.items[0].id);assert.equal(h.played.at(-1),'失败歌曲');assert.deepEqual(h.calls,['失败歌曲','正常歌曲','失败歌曲']);
});

for(const upstreamCode of ['503',undefined])test('an upstream failure stops the entire chart after the first request: '+(upstreamCode??'unknown status'),async t=>{
  const h=harness(t,async()=>{throw {code:'upstream',...(upstreamCode?{upstreamCode}:{})};});
  await h.api.playChart(chart(['一','二','三']));await tick();
  assert.deepEqual(h.calls,['一']);assert.equal(h.render().chartFailures.length,1);assert.match(h.render().error,/来源暂时/);assert.deepEqual(h.played,[]);
});

test('a new direct lookup revokes failure advancement from an already playing chart',async t=>{
  const pending=deferred();
  const h=harness(t,async title=>{if(title==='新点播')await pending.promise;});
  await h.api.playChart(chart(['旧歌曲','旧后继']));assert.deepEqual(h.played,['旧歌曲']);
  const selection=h.api.playChartItem({rank:1,title:'新点播'});await until(()=>h.calls.includes('新点播'));
  h.player.fail({code:'not-found'});await tick();await tick();
  assert.deepEqual(h.calls,['旧歌曲','新点播']);assert.deepEqual(h.played,['旧歌曲']);
  pending.resolve();await selection;assert.deepEqual(h.played,['旧歌曲','新点播']);assert.equal(h.queue.snapshot.items.length,3);assert.equal(h.queue.snapshot.items[2].title,'旧后继');
});

test('an unsuccessful direct lookup preserves the existing chart audio and queue',async t=>{
  const h=harness(t,async title=>title==='空点播'?{items:[]}:undefined);
  await h.api.playChart(chart(['旧歌曲','旧后继']));const before=h.queue.snapshot.items;
  await h.api.playChartItem({rank:1,title:'空点播'});
  assert.deepEqual(h.queue.snapshot.items,before);assert.equal(h.player.state,'playing');assert.equal(h.player.paused,false);assert.deepEqual(h.played,['旧歌曲']);
});

test('explicit playback reuses a chart item without substituting a new preferred version, then later chart selections recheck preferences',async t=>{
  const h=harness(t,async()=>undefined),tracks=batchTracks(['版本 A','版本 B']);
  let preferred=tracks[0],resolutions=0;
  globalThis[contextKey].request=async(_path,song)=>{assert.equal(song.title,'榜单歌曲');resolutions++;return {entry:preferred};};
  h.client.metadata=async ref=>tracks.find(track=>track.ref.id===ref.id);
  await h.api.playChart(chart(['榜单歌曲','未解析后继']));
  const ids=h.queue.snapshot.items.map(item=>item.id);
  preferred=tracks[1];
  assert.equal(await h.api.play(tracks[0]),true);
  assert.equal(h.render().snapshot.current.ref.id,tracks[0].ref.id);
  assert.equal(h.queue.snapshot.current.id,ids[0]);assert.deepEqual(h.queue.snapshot.items.map(item=>item.id),ids);
  assert.equal(resolutions,1,'an explicit selection does not repeat automatic matching');
  assert.equal(await h.api.select(ids[0]),true);
  assert.equal(h.render().snapshot.current.ref.id,tracks[1].ref.id);assert.equal(resolutions,2);
});

test('a cancelled explicit selection cannot override the next chart selection',async t=>{
  const h=harness(t,async()=>undefined),tracks=batchTracks(['版本 A','版本 B']),pending=deferred();
  let preferred=tracks[0],blockExplicit=false,started=false;
  globalThis[contextKey].request=async()=>({entry:preferred});
  h.client.metadata=async ref=>tracks.find(track=>track.ref.id===ref.id);
  h.bridge.source=async ref=>({resourceId:ref.id,prepare:async()=>{if(blockExplicit&&ref.id===tracks[0].ref.id){started=true;await pending.promise;}return {};}});
  await h.api.playChart(chart(['榜单歌曲']));
  const id=h.queue.snapshot.current.id;
  blockExplicit=true;const explicit=h.api.play(tracks[0]);await until(()=>started);
  preferred=tracks[1];assert.equal(await h.api.select(id),true);
  pending.resolve();await explicit;
  assert.equal(h.render().snapshot.current.ref.id,tracks[1].ref.id);assert.equal(h.player.state,'playing');
});

for(const failureStage of ['formats','prepare'])test(`a failed ${failureStage} lookup hides the previous track's quality until retry succeeds`,async t=>{
  const h=harness(t,async()=>undefined);
  const tracks=['旧歌曲','新歌曲'].map(title=>({ref:{provider:'bilibili',kind:'video',id:title},resourceId:title,title}));
  const formats=[{id:'251',codec:'opus',container:'webm'},{id:'30280',codec:'mp4a.40.2',container:'mp4'}];
  let failNew=true;
  h.client.metadata=async ref=>tracks.find(track=>track.ref.id===ref.id);
  h.bridge.source=async ref=>{
    const index=tracks.findIndex(track=>track.ref.id===ref.id);
    if(index===1&&failNew&&failureStage==='formats')throw {code:'upstream'};
    return {resourceId:ref.id,prepare:async()=>{
      if(index===1&&failNew&&failureStage==='prepare')throw {code:'upstream'};
      return {metadata:{format:formats[index]}};
    }};
  };
  await h.api.play(tracks[0],{tracks,index:0});
  failNew=false;await h.api.add(tracks[1]);failNew=true;
  assert.deepEqual(h.render().snapshot.format,formats[0]);
  await h.api.next();
  const failed=h.render().snapshot;
  assert.equal(failed.current.title,tracks[1].title);
  assert.equal(failed.loading,false);
  assert.equal(failed.state,'error');
  assert.deepEqual(h.player.currentMetadata.format,formats[0],'failed preparation really retains the prior plan');
  assert.equal(failed.format,undefined,'the failed track must not inherit the old quality badge');
  failNew=false;
  await h.api.retry();
  assert.deepEqual(h.render().snapshot.format,formats[1]);
  await h.api.toggle();
  assert.deepEqual(h.render().snapshot.format,formats[1],'pausing keeps the actual loaded format');
  await h.api.stop();
  assert.equal(h.render().snapshot.format,undefined,'stopped sources have no active format');
});

test('live part expansion is idempotent, preserves pending chart entries and naturally advances',async t=>{
  const h=harness(t,async()=>undefined),video='BV0000000001';
  const parts=['901','902','903'].map((part,index)=>({ref:{provider:'bilibili',kind:'video',id:video,part},resourceId:'part-'+part,title:'Part '+(index+1),url:'https://www.bilibili.com/video/'+video}));
  h.client.metadata=async ref=>({...parts.find(part=>!ref.part||part.ref.part===ref.part),parts});
  await h.api.playChart(chart([video,'未解析榜单歌曲']));
  const anchor=h.api.currentTrackId(),pending=h.queue.snapshot.items[1];h.player.currentTime=7;let loads=0;h.player.on('loadstart',()=>loads++);
  assert.equal(h.api.expandParts(anchor,parts),true);assert.equal(h.player.currentTime,7);assert.equal(loads,0);assert.equal(h.api.currentTrackId(),anchor);assert.equal(h.queue.snapshot.items.length,4);assert.equal(h.queue.snapshot.items[3].id,pending.id);
  assert.equal(h.api.expandParts(anchor,parts),true);assert.equal(h.queue.snapshot.items.length,4);assert.equal(loads,0);assert.equal(h.api.expandParts('stale-anchor',parts),false);
  h.player.finish();await until(()=>h.render().snapshot.current?.ref.part==='902'&&h.player.state==='playing');assert.equal(loads,1);assert.deepEqual(h.calls,[video]);assert.equal(h.queue.snapshot.items[3].id,pending.id);
});
test('single play bootstraps one song, inserts after current and continues the retained queue',async t=>{
  const h=harness(t,async()=>undefined),tracks=[1,2,3].map(n=>({ref:{provider:'bilibili',kind:'video',id:'BV'+String(n).padStart(10,'0'),part:'1'},resourceId:'t'+n,title:'Track '+n}));
  h.client.metadata=async ref=>tracks.find(t=>t.ref.id===ref.id);
  await h.api.play(tracks[0],{tracks,index:0});assert.equal(h.queue.snapshot.items.length,1);
  await h.api.add(tracks[1]);const original=h.queue.snapshot.items.map(item=>item.id);
  await h.api.play(tracks[2],{tracks,index:2});assert.deepEqual(h.queue.snapshot.items.map(item=>item.title),['Track 1','Track 3','Track 2']);assert.equal(h.queue.snapshot.items[0].id,original[0]);assert.equal(h.queue.snapshot.items[2].id,original[1]);
  h.player.finish();await until(()=>h.played.at(-1)==='Track 2');
  const id=h.queue.snapshot.current.id;await h.api.play(tracks[1]);assert.equal(h.queue.snapshot.items.length,3);assert.equal(h.queue.snapshot.current.id,id);
});
for(const mode of ['shuffle','one','all'])test('single insertion retains '+mode+' mode and pending chart identities',async t=>{
  const h=harness(t,async()=>undefined);await h.api.playChart(chart(['original','next']));const original=h.queue.snapshot.items.map(item=>item.id);
  if(mode==='shuffle')h.queue.setOrder('shuffle');else h.queue.setRepeat(mode);
  await h.api.playChartItem({rank:1,title:'inserted'});assert.equal(h.queue.snapshot.items.length,3);assert.equal(h.queue.snapshot.items[0].id,original[0]);assert.equal(h.queue.snapshot.items[2].id,original[1]);assert.equal(mode==='shuffle'?h.queue.snapshot.order:h.queue.snapshot.repeat,mode);
});
test('full queue rejects new singles but allows selecting an existing source',async t=>{
  const h=harness(t,async()=>undefined);await h.api.playChart(chart(Array.from({length:500},(_,i)=>'Song '+i)));const before=h.queue.snapshot.items;
  assert.equal(await h.api.playChartItem({rank:1,title:'extra'}),false);assert.deepEqual(h.queue.snapshot.items,before);assert.match(h.render().error,/500/);
  await h.api.playChartItem({rank:1,title:'Song 0'});assert.equal(h.queue.snapshot.items.length,500);assert.equal(h.queue.snapshot.current.id,before[0].id);
});
