import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MusicSources,MusicSourceError} from '@studio/music-sources';
import {BilibiliProvider} from '@studio/music-sources/bilibili';
import {createNodeHost} from '@studio/music-sources/node';
import {build} from 'esbuild';
const root=resolve(process.env.MUSIC_APP_TEST_BUILD??'.');
const {DesktopPlayback,desktopSourcePath}=await import(pathToFileURL(resolve(root,'dist/server/desktop-playback.js')));
const {verifySearchPlayback}=await import(pathToFileURL(resolve(root,'dist/server/search-playback.js')));
const {audioMime}=await import(pathToFileURL(resolve(root,'dist/server/audio-quality.js')));
const ref={provider:'bilibili',kind:'video',id:'BV1000000001',part:'901'},format={id:'30280',codec:'mp4a.40.2',mimeType:'audio/mp4',container:'mp4',bitrate:128000};
const entry={ref,resourceId:'audit-song',title:'周杰伦《晴天》',url:'https://www.bilibili.com/video/'+ref.id};
const playback={entry,resourceId:entry.resourceId,format,delivery:{url:'https://fixture.bilivideo.com/song.m4a',requiresHost:true}};
const support=[audioMime(format)],signal=()=>new AbortController().signal;
const gate=()=>{let release;return {promise:new Promise(resolve=>{release=resolve;}),release:()=>release()};};
const flush=()=>new Promise(resolve=>setTimeout(resolve,10));

test('desktop source budgets leave library imports, bulk saves, media and lease lifetimes unchanged',()=>{
  for(const path of ['/api/search','/api/search/resolve','/api/song-library/playback','/v1/call/prepare','/v1/call/metadata'])assert(desktopSourcePath(path));
  for(const path of ['/api/song-library/sources','/api/song-library/imports/preview','/api/song-library/sync/commit','/v1/media/lease','/v1/leases/lease','/api/status'])assert.equal(desktopSourcePath(path),false);
});

test('desktop best-audio preparation reuses view/playurl within one operation; later and mobile operations revalidate',async t=>{
  const work=new DesktopPlayback(()=> 'account-1'),counts={view:0,playurl:0},host=createNodeHost({fetch:work.fetch});
  work.setFetch(async input=>{
    const url=new URL(input);
    if(url.pathname==='/x/web-interface/view'){counts.view++;return Response.json({code:0,data:{bvid:ref.id,title:entry.title,pages:[{cid:Number(ref.part),part:'晴天',duration:120}],duration:120}});}
    if(url.pathname==='/x/web-interface/nav')return Response.json({code:0,data:{wbi_img:{img_url:'https://i.example/0123456789abcdef0123456789abcdef.png',sub_url:'https://i.example/abcdef0123456789abcdef0123456789.png'}}});
    if(url.pathname==='/x/player/wbi/playurl'){counts.playurl++;return Response.json({code:0,data:{dash:{audio:[{id:30280,codecs:format.codec,mimeType:format.mimeType,bandwidth:128000,baseUrl:playback.delivery.url}]}}});}
    throw Error('unexpected network');
  });
  const api=new MusicSources(host,{bilibili:new BilibiliProvider()});t.after(async()=>{work.dispose();await api.dispose();});
  for(let i=1;i<=2;i++){
    const prepared=await work.run('owner','prepare',signal(),s=>work.prepare(api,{ref},{signal:s},support));
    assert.equal(prepared.format.id,format.id);assert.deepEqual(counts,{view:i,playurl:i});
  }
  await api.formats(ref);await api.prepare({ref});assert.deepEqual(counts,{view:4,playurl:4});
  assert.equal(work.diagnostics().events.filter(event=>event.code==='reuse').length,4);
  assert(!JSON.stringify(work.diagnostics()).includes('bilivideo.com'));
});

test('verification transfers one owner-bound prepared result, replays and mismatched requests prepare afresh',async t=>{
  let preparations=0,formats=0;
  const work=new DesktopPlayback(()=> 'generation-1'),api={capabilities:()=>({operations:['formats']}),formats:async()=>{formats++;return [format];},prepare:async()=>{preparations++;return playback;}};
  t.after(()=>work.dispose());
  const checked=await work.run('left','resolve',signal(),s=>verifySearchPlayback(api,{now:Date.now,fetch:async()=>new Response(mp4Prefix(),{status:206,headers:{'Content-Range':'bytes 0-1023/2048'}})},ref,{signal:s},support,p=>work.verified(p)));
  assert.match(checked.preparationToken,/^[\w-]{32}$/);assert.equal(preparations,1);assert.equal(formats,1);
  await work.run('right','prepare',signal(),s=>work.prepare(api,{ref},{signal:s},support,checked.preparationToken));assert.equal(preparations,2);
  await work.run('left','prepare',signal(),s=>work.prepare(api,{ref:{...ref,part:'902'}},{signal:s},support,checked.preparationToken));assert.equal(preparations,3);
  await work.run('left','prepare',signal(),s=>work.prepare(api,{ref},{signal:s},support,checked.preparationToken));assert.equal(preparations,3);assert.equal(work.diagnostics().tickets,0);
  await work.run('left','prepare',signal(),s=>work.prepare(api,{ref},{signal:s},support,checked.preparationToken));assert.equal(preparations,4);
});

test('tickets expire, remain bounded, and cannot survive account/source changes or logout',async t=>{
  let now=1000,generation='one',preparations=0;
  const work=new DesktopPlayback(()=>generation,()=>now),api={capabilities:()=>({operations:[]}),prepare:async()=>{preparations++;return playback;}};
  t.after(()=>work.dispose());
  let token=await work.run('owner','verify',signal(),async()=>work.verified(playback));now+=15001;
  await work.run('owner','prepare',signal(),s=>work.prepare(api,{ref},{signal:s},support,token));assert.equal(preparations,1);
  token=await work.run('owner','verify',signal(),async()=>work.verified(playback));generation='two';
  await work.run('owner','prepare',signal(),s=>work.prepare(api,{ref},{signal:s},support,token));assert.equal(preparations,2);
  await work.run('owner','verify',signal(),async()=>{for(let i=0;i<50;i++)work.verified(playback);});assert.equal(work.diagnostics().tickets,32);
  work.cancelOwner('owner');assert.equal(work.diagnostics().tickets,0);
});

test('desktop upstream reuse isolates headers and exact part, and rejects late generation changes',async t=>{
  let generation='one',calls=0;const work=new DesktopPlayback(()=>generation);t.after(()=>work.dispose());
  work.setFetch(async()=>{calls++;return Response.json({value:calls});});
  await work.run('owner','prepare',signal(),async()=>{
    const read=(cid,cookie)=>work.fetch('https://api.bilibili.com/x/player/wbi/playurl?cid='+cid,{headers:{Cookie:cookie}});
    assert.equal((await (await read('901','one')).json()).value,1);
    assert.equal((await (await read('901','one')).json()).value,1);
    await read('902','one');await read('901','two');assert.equal(calls,3);
  });
  const held=gate();work.setFetch(async()=>{await held.promise;return Response.json({value:4});});
  const pending=work.run('owner','prepare',signal(),()=>work.fetch('https://api.bilibili.com/x/web-interface/view?bvid='+ref.id));
  generation='two';held.release();await assert.rejects(pending,{code:'cancelled'});
});
test('a desktop deadline cancels a stalled upstream body and discards any preparation from a failed operation',async t=>{
  const work=new DesktopPlayback(()=> 'same');t.after(()=>work.dispose());let cancelled=0;
  work.setFetch(async()=>new Response(new ReadableStream({cancel(){cancelled++;}})));
  await assert.rejects(work.run('owner','stalled',signal(),()=>work.fetch('https://api.bilibili.com/x/web-interface/view?bvid='+ref.id),2,25),{code:'timeout'});assert.equal(cancelled,1);
  await assert.rejects(work.run('owner','late',signal(),async()=>{work.verified(playback);throw new MusicSourceError({code:'network',retryable:true});}),{code:'network'});
  await work.run('owner','http-error',signal(),async()=>{work.verified(playback);work.response(503);});
  assert.equal(work.diagnostics().tickets,0);
  assert.equal(work.diagnostics().events.at(-1).code,'failure');assert.equal(work.diagnostics().timings['http-error'],undefined);
});

test('desktop scheduling reserves the fourth source slot for playback and prioritizes queued playback',async t=>{
  const work=new DesktopPlayback(()=> 'same'),held=gate(),starts=[];t.after(()=>{held.release();work.dispose();});
  const execute=(id,priority)=>work.run('owner',id,signal(),s=>work.call('bilibili',{signal:s},async()=>{starts.push(id);await held.promise;return id;}),priority);
  const background=[execute('bg1',0),execute('bg2',0),execute('bg3',0),execute('bg4',0)];
  await flush();assert.deepEqual(starts,['bg1','bg2','bg3']);
  const playback=execute('play',2);await flush();assert.deepEqual(starts,['bg1','bg2','bg3','play']);
  const next=execute('recover',2);assert.equal(work.diagnostics().pending,2);
  held.release();await Promise.all([...background,playback,next]);assert(starts.indexOf('recover')<starts.indexOf('bg4'));
  assert.equal(work.diagnostics().active,0);assert.equal(work.diagnostics().pending,0);
});

test('queued cancellation and deadline do not execute abandoned source work, and upstream errors never spin',async t=>{
  const work=new DesktopPlayback(()=> 'same'),held=gate();t.after(()=>{held.release();work.dispose();});
  const background=Array.from({length:3},()=>work.run('owner','background',signal(),s=>work.call('bilibili',{signal:s},()=>held.promise),0));
  const controller=new AbortController();let calls=0;
  const abandoned=work.run('owner','queued',controller.signal,s=>work.call('bilibili',{signal:s},async()=>{calls++;}),0);controller.abort();await assert.rejects(abandoned,{code:'cancelled'});
  await assert.rejects(work.run('owner','deadline',signal(),s=>work.call('bilibili',{signal:s},async()=>{calls++;}),0,20),{code:'timeout'});assert.equal(calls,0);
  held.release();await Promise.all(background);
  await assert.rejects(work.run('owner','error',signal(),s=>work.call('bilibili',{signal:s},async()=>{calls++;throw new MusicSourceError({code:'rate-limited',retryable:true});})),{code:'rate-limited'});assert.equal(calls,1);
  await assert.rejects(work.run('owner','capacity',signal(),s=>work.call('bilibili',{signal:s},async()=>{throw new MusicSourceError({code:'busy',retryable:true});}),2,65),{code:'timeout'});
});

const bundled=await build({stdin:{contents:"export {BestAudioBridge} from './src/audio-quality.ts'; export {connectSourceClient} from './src/source-client.ts';",resolveDir:resolve('.')},bundle:true,platform:'node',format:'esm',write:false});
const browserModules=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
test('desktop bridge negotiates one optimized protocol prepare and carries timeout policy through refresh; mobile keeps original requests',async()=>{
  const originalWindow=globalThis.window,originalFetch=globalThis.fetch;let desktop=true;const calls=[];
  globalThis.window={matchMedia:()=>({matches:desktop}),dispatchEvent:()=>{}};
  globalThis.fetch=async(input,options)=>{
    const path=new URL(input).pathname,headers=new Headers(options.headers),body=options.body?JSON.parse(options.body):undefined;calls.push({path,headers,body});
    if(path==='/v1/handshake')return Response.json({protocol:2,capabilities:[{provider:'bilibili',operations:['metadata','formats','prepare','slowtune-desktop-audio'],anonymous:true,limitations:[]}]});
    if(path==='/v1/call/metadata')return Response.json({protocol:2,result:entry});
    if(path==='/v1/call/formats')return Response.json({protocol:2,result:[format]});
    if(path==='/v1/call/prepare')return Response.json({protocol:2,result:{...playback,delivery:{url:'http://fixture/media',requiresHost:false}}});
    throw Error('unexpected network');
  };
  let bridge,client;
  try{
    client=await browserModules.connectSourceClient('http://fixture',signal());bridge=new browserModules.BestAudioBridge(client,{canPlayType:()=> 'probably'});
    const source=await bridge.sourceFrom({...entry,verifiedAudio:{ref,format,preparationToken:'a'.repeat(32)}}),plan=await source.prepare({signal:signal()});
    assert.deepEqual(plan.timeouts,{resolve:60,initial:30,stall:30});
    let prepares=calls.filter(call=>call.path==='/v1/call/prepare');assert.equal(prepares.length,1);assert.equal(calls.filter(call=>call.path==='/v1/call/formats').length,0);
    assert.equal(prepares[0].headers.get('X-SlowTune-Preparation'),'a'.repeat(32));assert.equal(prepares[0].body.request.slowTuneDesktopAudio,undefined);
    const refreshed=await bridge.resolver.resolveUrl(source.resourceId,plan,'retry',{signal:signal()});assert.deepEqual(refreshed.timeouts,plan.timeouts);
    await bridge.dispose();desktop=false;calls.length=0;
    bridge=new browserModules.BestAudioBridge(client,{canPlayType:()=> 'probably'});const mobile=await bridge.sourceFrom(entry),mobilePlan=await mobile.prepare({signal:signal()});
    assert.equal(mobilePlan.timeouts,undefined);assert.equal(calls.filter(call=>call.path==='/v1/call/formats').length,1);
    prepares=calls.filter(call=>call.path==='/v1/call/prepare');assert.equal(prepares[0].headers.has('X-SlowTune-Surface'),false);assert.equal(prepares[0].headers.has('X-SlowTune-Audio-Support'),false);
  }finally{await bridge?.dispose();client?.dispose();globalThis.window=originalWindow;globalThis.fetch=originalFetch;}
});
import {mp4Prefix} from './fixtures/audio-prefix.mjs';
