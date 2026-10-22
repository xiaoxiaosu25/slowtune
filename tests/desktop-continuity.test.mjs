import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {MediaDelivery} from '@studio/music-sources/service';
const root=resolve(process.env.MUSIC_APP_TEST_BUILD??'.');
const {DesktopPlayback}=await import(pathToFileURL(resolve(root,'dist/server/desktop-playback.js')));
const {MusicSearch}=await import(pathToFileURL(resolve(root,'dist/server/music-search.js')));
const {SearchSettingsStore}=await import(pathToFileURL(resolve(root,'dist/server/search-settings.js')));
const bundle=await build({stdin:{contents:"export * from './src/desktop-continuity.ts';export * from './src/playback-recovery.ts';",resolveDir:resolve('.')},bundle:true,platform:'node',format:'esm',write:false});
const {DesktopNextPrefetch,PlaybackRecovery}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const signal=()=>new AbortController().signal;
const gate=()=>{let release;return {promise:new Promise(resolve=>{release=resolve;}),release};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const ref={provider:'bilibili',kind:'video',id:'BV1000000001',part:'901'},format={id:'aac',codec:'mp4a.40.2',mimeType:'audio/mp4',container:'mp4'};
const entry={ref,resourceId:'song',title:'周杰伦《晴天》',url:'https://example.com'};
const prepared={entry,resourceId:'song',format,delivery:{url:'https://example.com/media',requiresHost:true}};

test('identical desktop consumers share work; cancelling either consumer leaves its peer and evicts settled results',async t=>{
  for(const cancel of [0,1]){
    const work=new DesktopPlayback(()=> 'one'),held=gate(),controllers=[new AbortController(),new AbortController()];let calls=0,upstream;
    t.after(()=>work.dispose());
    const read=c=>work.run('owner','search',c.signal,s=>work.share(['same',{credentialRef:'one'}],s,async signal=>{calls++;upstream=signal;await held.promise;signal.throwIfAborted();return entry;}));
    const pending=controllers.map(read);await tick();controllers[cancel].abort();
    await assert.rejects(pending[cancel],{code:'cancelled'});assert.equal(upstream.aborted,false);
    held.release();assert.equal(await pending[1-cancel],entry);assert.equal(calls,1);
    await read(new AbortController());assert.equal(calls,2);assert.equal(work.diagnostics().inflight,0);
  }
});

test('last subscriber cancels producer; failures can retry and account/owner identities remain isolated',async t=>{
  let generation='one',calls=0;const work=new DesktopPlayback(()=>generation);t.after(()=>work.dispose());
  const controller=new AbortController();let upstream;
  const pending=work.run('a','read',controller.signal,s=>work.share(['read'],s,signal=>new Promise((_,reject)=>{upstream=signal;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})));
  await tick();controller.abort();await assert.rejects(pending);assert.equal(upstream.aborted,true);
  const held=gate(),read=(owner,credential)=>work.run(owner,'read',signal(),s=>work.share(['read',credential],s,async()=>{calls++;await held.promise;return calls;}));
  const old=read('a','one'),peer=read('b','one'),credentials=read('a','two');await tick();assert.equal(calls,3);
  generation='two';const fresh=read('a','one');await tick();assert.equal(calls,4);held.release();
  const results=await Promise.allSettled([old,peer,credentials,fresh]);assert.deepEqual(results.map(result=>result.status),['rejected','rejected','rejected','fulfilled']);
  let fail=true;
  const retry=()=>work.run('a','read',signal(),s=>work.share('retry',s,async()=>{if(fail)throw Error('network');return 7;}));
  await assert.rejects(retry(),/network/);fail=false;assert.equal(await retry(),7);assert.equal(work.diagnostics().inflight,0);
});

test('a foreground consumer promotes shared prefetch waiting behind background work into the reserved playback slot',async t=>{
  const work=new DesktopPlayback(()=> 'same'),held=gate(),starts=[];t.after(()=>{held.release();work.dispose();});
  const background=Array.from({length:3},(_,id)=>work.run('a','background',signal(),s=>work.call('bilibili',{signal:s},async()=>{starts.push(id);await held.promise;}),0));
  await tick();
  const read=priority=>work.run('a','source',signal(),s=>work.share('same-source',s,signal=>work.call('bilibili',{signal},async()=>{starts.push('shared');return entry;})),priority);
  const prefetch=read(0);await tick();assert.equal(starts.length,3);
  const play=read(2);assert.equal(await play,entry);assert.equal(await prefetch,entry);assert.deepEqual(starts,[0,1,2,'shared']);
  held.release();await Promise.all(background);
});

test('shared raw preparations publish independent media leases for each successful caller',async t=>{
  const work=new DesktopPlayback(()=> 'same'),delivery=new MediaDelivery({now:Date.now,fetch}),held=gate();let prepares=0;
  t.after(async()=>{work.dispose();await delivery.dispose();});
  const api={capabilities:()=>({operations:[]}),prepare:async()=>{prepares++;await held.promise;return prepared;}};
  const prepare=()=>work.run('a','prepare',signal(),s=>work.prepare(api,{ref},{signal:s},['audio/mp4; codecs="mp4a.40.2"'])).then(result=>delivery.publish(result,'http://fixture'));
  const one=prepare(),two=prepare();await tick();held.release();const [left,right]=await Promise.all([one,two]);
  assert.equal(prepares,1);assert.notEqual(left.leaseId,right.leaseId);assert.equal(delivery.diagnostics().leases,2);
  await delivery.release(left.leaseId);assert.equal(delivery.diagnostics().leases,1);await delivery.release(right.leaseId);
});

test('cancelling all waiters before dispatch releases bookkeeping, and a new request does not join an abandoned producer',async t=>{
  const work=new DesktopPlayback(()=> 'same');t.after(()=>work.dispose());
  const controller=new AbortController();let calls=0;
  const read=signal=>work.run('a','read',signal,s=>work.share('same',s,async()=>{calls++;return calls;}));
  const pending=read(controller.signal);controller.abort();await assert.rejects(pending,{code:'cancelled'});
  assert.equal(work.diagnostics().inflight,0);assert.equal(work.sharedWork.size,0);assert.equal(calls,0);
  assert.equal(await read(signal()),1);assert.equal(work.sharedWork.size,0);
});

test('complete desktop matching shares validation, while settings/audio capabilities and mobile calls isolate identities',async t=>{
  const store=new SearchSettingsStore(':memory:','test'),work=new DesktopPlayback(()=> 'same'),held=gate();let searches=0,verifications=0;
  const search=new MusicSearch(store,{search:async()=>{searches++;await held.promise;return {items:[entry]};},metadata:async()=>entry},async()=>({tid_v2:2016}),()=>false,()=> 'same',Date.now,async()=>{verifications++;return {ref,format};},(identity,signal,task)=>work.share(identity,signal,task));
  t.after(()=>{search.dispose();work.dispose();store.close();});
  const query={title:'晴天',artists:['周杰伦'],searchMode:'title-artists',audioSupport:['audio/mp4; codecs="mp4a.40.2"']};
  const resolve=(input=query)=>work.run('a','resolve',signal(),s=>search.resolve(input,s));
  const first=resolve(),second=resolve(),otherSupport=resolve({...query,audioSupport:['audio/webm; codecs="opus"']});await tick();assert.equal(searches,2);
  const state=store.read();store.saveConfig(state.revision,state.config);const changed=resolve();await tick();assert.equal(searches,3);
  held.release();const results=await Promise.allSettled([first,second,otherSupport,changed]);assert.equal(results[3].status,'fulfilled');assert.equal(verifications,1);
  await Promise.all([search.search({provider:'bilibili',query:'晴天'},signal()),search.search({provider:'bilibili',query:'晴天'},signal())]);assert.equal(searches,5,'non-desktop requests bypass sharing');
});

test('raw next-track preparation transfers once without publishing a lease or reading media; revoked and expired tokens prepare afresh',async t=>{
  let calls=0,now=1000;const work=new DesktopPlayback(()=> 'same',()=>now),api={capabilities:()=>({operations:[]}),prepare:async()=>{calls++;return prepared;}};t.after(()=>work.dispose());
  const warm=()=>work.run('a','prefetch',signal(),async s=>work.verified(await work.prepare(api,{ref},{signal:s},['audio/mp4; codecs="mp4a.40.2"'])) ,0);
  let token=await warm();assert.equal(calls,1);assert.equal(prepared.leaseId,undefined);
  await work.run('a','play',signal(),s=>work.prepare(api,{ref},{signal:s},['audio/mp4; codecs="mp4a.40.2"'],token));assert.equal(calls,1);
  token=await warm();await work.run('a','discard',signal(),async()=>work.discard(token));assert.equal(work.diagnostics().tickets,0);
  token=await warm();now+=15001;await work.run('a','play',signal(),s=>work.prepare(api,{ref},{signal:s},['audio/mp4; codecs="mp4a.40.2"'],token));assert.equal(calls,4);
});

test('next prefetch is single-use, bounded, expires, aborts on edits and releases late completions',async()=>{
  const released=[],held=gate();let now=1000,upstream,calls=0;
  const prefetch=new DesktopNextPrefetch(value=>released.push(value),()=>now);
  prefetch.start('next','queue-1',async signal=>{upstream=signal;calls++;await held.promise;return 'late';});await tick();
  prefetch.start('next','queue-1',async()=>assert.fail());assert.equal(calls,1);assert.equal(prefetch.size,1);
  prefetch.retain(['different']);assert.equal(upstream.aborted,true);held.release();await tick();assert.deepEqual(released,['late']);
  prefetch.start('next','queue-2',async()=> 'ready');await tick();assert.equal(prefetch.take('next'),'ready');assert.equal(prefetch.take('next'),undefined);
  prefetch.start('next','queue-3',async()=> 'expired');await tick();now+=10001;assert.equal(prefetch.take('next'),undefined);assert.deepEqual(released,['late','expired']);
  prefetch.start('next','queue-3',async()=>assert.fail('no repeated warming in one queue generation'));assert.equal(prefetch.size,0);
  prefetch.reset();
});

class Player {
  currentResourceId='queue:one';currentPlan={expiresAt:1};currentTime=120;state='playing';playbackRequested=true;paused=false;failed=false;canPrepareSource=true;events=new Map();calls=0;cancels=0;
  sourceController={cancelSourcePreparation:()=>this.cancels++};
  on(event,fn){const listeners=this.events.get(event)??new Set();listeners.add(fn);this.events.set(event,listeners);return ()=>listeners.delete(fn);}
  emit(event){for(const fn of this.events.get(event)??[])fn();}
  pause(){this.paused=true;this.playbackRequested=false;this.emit('pauseintent');}
  requestPlayback(){this.playbackRequested=true;this.emit('playintent');}
  async prepareSource(context){this.calls++;this.position=context.positionSeconds;await this.wait?.promise;}
}
test('overlapping online/wake events recover once at the checkpoint, retaining the latest pause intent',async()=>{
  const player=new Player(),audio=new EventTarget(),recovery=new PlaybackRecovery(player,audio);player.wait=gate();
  recovery.capture(120,false);const one=recovery.environmentChanged(),two=recovery.environmentChanged();await tick();assert.equal(player.calls,1);player.pause();player.wait.release();await Promise.all([one,two]);assert.equal(player.position,120);assert.equal(player.playbackRequested,false);
  await recovery.environmentChanged();assert.equal(player.calls,1);recovery.dispose();
});
test('stopped, ended, offline, paused and freshly healthy media do not trigger unnecessary recovery',async()=>{
  const player=new Player(),audio=new EventTarget(),recovery=new PlaybackRecovery(player,audio);
  for(const state of ['stopped','ended','loading','idle']){player.state=state;await recovery.environmentChanged();}player.state='playing';player.pause();await recovery.environmentChanged();assert.equal(player.calls,0);
  player.requestPlayback();player.currentPlan={expiresAt:Date.now()+60000};const pending=recovery.environmentChanged();player.currentTime++;await pending;assert.equal(player.calls,0);recovery.dispose();
});
test('new selection/disposal cancels pending recovery, and failures observe a bounded retry window',async()=>{
  const player=new Player(),audio=new EventTarget(),recovery=new PlaybackRecovery(player,audio);player.wait=gate();
  const pending=recovery.environmentChanged();await tick();player.emit('loadstart');player.currentResourceId='queue:two';player.wait.release();await assert.rejects(pending,{name:'AbortError'});assert.equal(player.cancels,1);
  player.wait=undefined;await recovery.environmentChanged();assert.equal(player.calls,1,'events within ten seconds do not spin after a failed recovery');recovery.dispose();await recovery.environmentChanged();assert.equal(player.calls,1);
});

test('automatic recovery stays offline and makes at most two attempts per selected resource',async()=>{
  const player=new Player(),audio=new EventTarget(),recovery=new PlaybackRecovery(player,audio),originalNow=Date.now,online=Object.getOwnPropertyDescriptor(navigator,'onLine');let now=100000;
  Date.now=()=>now;
  try{
    Object.defineProperty(navigator,'onLine',{value:false,configurable:true});await recovery.environmentChanged();assert.equal(player.calls,0);
    Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
    for(let i=0;i<5;i++){await recovery.environmentChanged();now+=10001;}
    assert.equal(player.calls,2);
  }finally{Date.now=originalNow;if(online)Object.defineProperty(navigator,'onLine',online);else delete navigator.onLine;recovery.dispose();}
});

test('wake recovery defers to an existing player refresh or fallback',async()=>{
  const player=new Player(),audio=new EventTarget(),recovery=new PlaybackRecovery(player,audio),held=gate();
  const source=recovery.trackSource(()=>held.promise);await recovery.environmentChanged();assert.equal(player.calls,0);held.release();await source;recovery.dispose();
});

test('a sleep checkpoint restores the previous playback intent after a native pause, while an explicit pause blocks wake',async()=>{
  const player=new Player(),audio=new EventTarget(),recovery=new PlaybackRecovery(player,audio);
  recovery.capture(120,false);player.playbackRequested=false;player.paused=true;player.state='paused';
  await recovery.environmentChanged();assert.equal(player.calls,1);assert.equal(player.position,120);assert.equal(player.playbackRequested,true);
  player.pause();await recovery.environmentChanged();assert.equal(player.calls,1);assert.equal(player.playbackRequested,false);recovery.dispose();
});
