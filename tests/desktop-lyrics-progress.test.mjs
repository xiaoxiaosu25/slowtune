import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {loadSongModule} from './helpers/song-services.mjs';
const {LyricsStore}=await loadSongModule('lyrics-store'),{LyricProviders}=await loadSongModule('lyrics-providers'),{createLyricsRouter}=await loadSongModule('lyrics-http');
const row={id:123,trackName:'晴天',artistName:'周杰伦',duration:270,syncedLyrics:'[00:01]歌词'};
const query={title:'晴天',artist:'周杰伦',durationSeconds:270},signal=()=>new AbortController().signal;
function setup(t,fetcher,budgets){const store=new LyricsStore(':memory:','progress'),provider=new LyricProviders(store,fetcher,Date.now,budgets);t.after(async()=>{await provider.dispose();store.close();});return {store,provider};}
test('desktop progressive search publishes fast success before the slow provider; partial failures retry',async t=>{
  let release,calls=0;const gate=new Promise(resolve=>release=resolve),seen=[];
  const {provider}=setup(t,async url=>{calls++;if(new URL(url).hostname==='music.163.com'){await gate;return new Response('',{status:503});}return Response.json([row]);});
  const pending=provider.search(query,signal(),true,value=>seen.push(value));await delay(10);
  assert.equal(seen.length,1);assert.equal(seen[0].candidates[0].id,'123');release();assert.equal((await pending).issues[0].code,'upstream');
  await provider.search(query,signal(),true);assert.equal(calls,4);
});
test('same desktop provider lookups and documents share work with independent cancellation and isolated results',async t=>{
  let calls=0,cancels=0,release;const gate=new Promise(resolve=>release=resolve);
  const {provider}=setup(t,async(url,{signal})=>{calls++;signal.addEventListener('abort',()=>cancels++,{once:true});await gate;return Response.json(new URL(url).hostname==='music.163.com'?{code:200,result:{songs:[]}}:[row]);});
  const stop=new AbortController(),one=provider.search(query,stop.signal,true),two=provider.search(query,signal(),true);
  const rejected=assert.rejects(one,{code:'cancelled'});await delay(5);stop.abort();await rejected;assert.equal(cancels,0);release();const found=await two;assert.equal(found.candidates.length,1);found.candidates[0].artists[0]='poison';assert.equal(calls,2);
  const [a,b]=await Promise.all([provider.document({provider:'lrclib',id:'123'},signal(),true),provider.document({provider:'lrclib',id:'123'},signal(),true)]);
  a.lines[0].text='poison';assert.equal(b.lines[0].text,'歌词');assert.deepEqual(b.artists,['周杰伦']);assert.equal(calls,2);
});
test('last consumer cancellation aborts both upstream providers; failures and total budgets leave no cached success',async t=>{
  let calls=0,aborted=0;
  const {provider}=setup(t,async(_url,{signal})=>{calls++;try{await delay(500,undefined,{signal});}catch(error){aborted++;throw error;}return Response.json([]);},{searchMs:35,documentMs:35});
  const stop=new AbortController(),pending=provider.search(query,stop.signal,true);await delay(5);stop.abort();await assert.rejects(pending,{code:'cancelled'});await delay(5);assert.equal(aborted,2);
  await assert.rejects(provider.search(query,signal(),true),{code:'timeout'});await delay(5);assert.equal(calls,4);assert.equal(aborted,4);
});
test('NetEase trusted search metadata avoids detail; otherwise detail and text start concurrently',async t=>{
  const paths=[];let release;const gate=new Promise(resolve=>release=resolve);
  const {provider}=setup(t,async input=>{const url=new URL(input);paths.push(url.pathname);if(url.hostname==='lrclib.net')return Response.json([]);if(url.pathname.includes('search'))return Response.json({code:200,result:{songs:[{id:123,name:'晴天',artists:[{name:'周杰伦'}],duration:270000}]}});if(url.pathname.endsWith('detail')){await gate;return Response.json({code:200,songs:[{id:124,name:'晴天',artists:[{name:'周杰伦'}],duration:270000}]});}return Response.json({code:200,lrc:{lyric:'[00:01]歌词'}});});
  await provider.search(query,signal(),true);await provider.document({provider:'netease',id:'123'},signal(),true);assert.equal(paths.filter(path=>path.endsWith('detail')).length,0);
  const pending=provider.document({provider:'netease',id:'124'},signal(),true);await delay(5);assert.equal(paths.filter(path=>path.endsWith('lyric')).length,2);release();assert.equal((await pending).id,'124');
});
test('HTTP progress, cancellation and complete-search ambiguity checks preserve revision and offset',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const {store,provider}=setup(t,async input=>{if(new URL(input).hostname==='music.163.com'){await gate;return Response.json({code:200,result:{songs:[{id:124,name:'晴天',artists:[{name:'另一歌手'}],duration:270000}]}});}return Response.json([row]);});
  const app=createLyricsRouter(store,provider,()=> 'test'),ref={provider:'bilibili',kind:'video',id:'BV0000000001',part:'1'};
  const post=(path,body)=>app.request('http://localhost'+path,{method:'POST',headers:{'X-Music-App':'1','X-SlowTune-Surface':'desktop','Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await post('/search-progress',query),reader=response.body.getReader();const first=JSON.parse(new TextDecoder().decode((await reader.read()).value));assert.equal(first.complete,false);assert.equal(first.candidates[0].id,'123');
  const resolving=post('/resolve',{ref,title:'晴天',durationSeconds:270});await delay(5);assert.equal(store.read(ref).document,null);release();const result=await(await resolving).json();assert.equal(result.matched,false);assert.equal(result.candidates.length,2);await reader.cancel();
  const old=store.read(ref);const saved=store.update(ref,old.revision,state=>{state.document={...row,provider:'local',id:'choice',title:'手动',artists:[],synced:true,lines:[{startMs:0,text:'manual'}]};state.offsetMs=1500;},signal());
  assert.deepEqual((await(await post('/resolve',{ref,...query})).json()).state,saved);
});
test('uncached document consumers cancel independently; the final departure cancels the producer and can retry',async t=>{
  let calls=0,release,aborts=0;let gate=new Promise(resolve=>release=resolve);
  const {provider}=setup(t,async(_url,{signal})=>{calls++;signal.addEventListener('abort',()=>aborts++,{once:true});await gate;return Response.json(row);});
  const target={provider:'lrclib',id:'123'},stop=new AbortController(),one=provider.document(target,stop.signal,true),two=provider.document(target,signal(),true),rejected=assert.rejects(one,{code:'cancelled'});
  await delay(5);stop.abort();await rejected;assert.equal(aborts,0);release();assert.equal((await two).id,'123');assert.equal(calls,1);
  aborts=0;gate=new Promise(resolve=>release=resolve);const lastStop=new AbortController(),last=provider.document({provider:'lrclib',id:'124'},lastStop.signal,true),cancelled=assert.rejects(last,{code:'cancelled'});await delay(5);lastStop.abort();await delay(5);assert.equal(aborts,1);release();await cancelled;
  await assert.rejects(provider.document({provider:'lrclib',id:'124'},signal(),true),{code:'not-found'});assert.equal(calls,3);
});
test('one HTTP budget covers search plus document and cannot commit a late automatic choice',async t=>{
  const {store,provider}=setup(t,async(input,{signal})=>{const url=new URL(input),search=url.pathname.includes('search');await delay(search?15:80,undefined,{signal});if(url.hostname==='lrclib.net')return Response.json([]);return Response.json(search?{code:200,result:{songs:[{id:123,name:'晴天',artists:[{name:'周杰伦'}],duration:270000}]}}:{code:200,lrc:{lyric:'[00:01]歌词'}});});
  const app=createLyricsRouter(store,provider,()=> 'test',45),ref={provider:'bilibili',kind:'video',id:'BV0000000001',part:'1'};
  const response=await app.request('http://localhost/resolve',{method:'POST',headers:{'Content-Type':'application/json','X-Music-App':'1','X-SlowTune-Surface':'desktop'},body:JSON.stringify({ref,...query})});
  assert.equal(response.status,503);assert.equal((await response.json()).error.code,'timeout');assert.equal(store.read(ref).document,null);
});
test('desktop operation budget includes a stalled request body and closes the input stream',async t=>{
  const {store,provider}=setup(t,async()=>assert.fail('must not reach a provider'));let cancelled=0,timer;
  const app=createLyricsRouter(store,provider,()=> 'test',35);
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"title":"晴天"'));timer=setTimeout(()=>{c.enqueue(new TextEncoder().encode('}'));c.close();},200);},cancel(){cancelled++;clearTimeout(timer);}});
  const response=await app.request(new Request('http://localhost/search',{method:'POST',headers:{'Content-Type':'application/json','X-Music-App':'1','X-SlowTune-Surface':'desktop'},body,duplex:'half'}));
  assert.equal(response.status,503);assert.equal((await response.json()).error.code,'timeout');assert.equal(cancelled,1);
});
test('a concurrent desktop lyric choice and offset win over a late automatic candidate',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const {store,provider}=setup(t,async input=>{await gate;return Response.json(new URL(input).hostname==='music.163.com'?{code:200,result:{songs:[]}}:[row]);});
  const app=createLyricsRouter(store,provider,()=> 'test'),ref={provider:'bilibili',kind:'video',id:'BV0000000001',part:'1'};
  const pending=app.request('http://localhost/resolve',{method:'POST',headers:{'Content-Type':'application/json','X-Music-App':'1','X-SlowTune-Surface':'desktop'},body:JSON.stringify({ref,...query})});await delay(5);
  const saved=store.update(ref,null,state=>{state.document={provider:'local',id:'manual',title:'人工选择',artists:[],synced:true,lines:[{startMs:0,text:'保留'}]};state.offsetMs=750;},signal());release();
  const result=await(await pending).json();assert.equal(result.matched,false);assert.deepEqual(result.state,saved);
});
