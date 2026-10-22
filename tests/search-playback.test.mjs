import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MusicSourceError} from '@studio/music-sources';
import {mp4Prefix} from './fixtures/audio-prefix.mjs';
const {verifySearchPlayback}=await import(pathToFileURL(resolve(process.env.MUSIC_APP_TEST_BUILD??'.','dist/server/search-playback.js')));
const {audioMime}=await import(pathToFileURL(resolve(process.env.MUSIC_APP_TEST_BUILD??'.','dist/server/audio-quality.js')));

const ref={provider:'bilibili',kind:'video',id:'BV118411B7XU',part:'1262792384'};
const playback={resourceId:'rain',entry:{ref,title:'杨丞琳《雨爱》',durationSeconds:263,url:'https://www.bilibili.com/video/'+ref.id},format:{id:'30280',codec:'mp4a.40.2',mimeType:'audio/mp4',container:'mp4'},delivery:{url:'https://test.bilivideo.com/rain.m4a',requiresHost:true,headers:{Referer:'https://www.bilibili.com/'}}};
const options=()=>({signal:new AbortController().signal});

test('automatic audio verification reads a bounded range with source headers and closes the stream',async()=>{
  let cancelled=0,prepares=0;
  const host={now:Date.now,fetch:async(url,input)=>{
    assert.equal(url,playback.delivery.url);const headers=new Headers(input.headers);assert.equal(headers.get('Range'),'bytes=0-1023');assert.equal(headers.get('Referer'),'https://www.bilibili.com/');
    return new Response(new ReadableStream({start(controller){controller.enqueue(mp4Prefix());},cancel(){cancelled++;}}),{status:206,headers:{'Content-Range':'bytes 0-1023/2048','Content-Length':'1024'}});
  }};
  await verifySearchPlayback({prepare:async(request)=>{prepares++;assert.deepEqual(request,{ref,media:'audio',quality:'highest'});return playback;}},host,ref,options());
  assert.equal(prepares,1);assert.equal(cancelled,1);
});
test('a successful audio prepare cannot hide CDN rejection, empty content or malformed range',async()=>{
  for(const [status,code]of [[403,'restricted'],[404,'not-found'],[429,'rate-limited'],[503,'upstream']]){
    await assert.rejects(verifySearchPlayback({prepare:async()=>playback},{now:Date.now,fetch:async()=>new Response(null,{status})},ref,options()),{code});
  }
  await assert.rejects(verifySearchPlayback({prepare:async()=>playback},{now:Date.now,fetch:async()=>new Response(null,{status:206,headers:{'Content-Range':'bytes 0-1023/2048'}})},ref,options()),{code:'protocol'});
  await assert.rejects(verifySearchPlayback({prepare:async()=>playback},{now:Date.now,fetch:async()=>new Response(new Uint8Array([1]),{status:200})},ref,options()),{code:'protocol'});
});
test('audio verification retains account identity and cancellation without leaking a read',async()=>{
  const controller=new AbortController();let cancelled=0;
  const host={now:Date.now,credentials:{read:async()=>({revision:'account-1'})},fetch:async(_url,{signal})=>{
    const stream=new ReadableStream({cancel(){cancelled++;}});
    queueMicrotask(()=>controller.abort());return new Response(stream,{status:206,headers:{'Content-Range':'bytes 0-1023/2048'}});
  }};
  await assert.rejects(verifySearchPlayback({prepare:async()=>({...playback,delivery:{...playback.delivery,credentialRevision:'account-1'}})},host,ref,{signal:controller.signal,credentialRef:'account'}),error=>error.name==='AbortError'||error.code==='cancelled');
  assert.equal(cancelled,1);
});

const aac={...playback.format},flac={id:'30251',codec:'fLaC',mimeType:'audio/mp4',container:'mp4'};
test('desktop verification keeps a candidate when either its FLAC or AAC rendition is readable',async()=>{
  for(const rejected of [aac.id,flac.id]){
    const prepared=[],reads=[],closed=[];
    const api={capabilities:()=>({operations:['formats','prepare']}),formats:async()=>[aac,flac],prepare:async(request,options)=>{
      assert.equal(options.credentialRef,'account');prepared.push(request);
      const format=[aac,flac].find(format=>format.id===request.formatId);assert(format);assert.deepEqual(request.codecs,[format.codec]);
      return {...playback,format,delivery:{...playback.delivery,url:'https://test.bilivideo.com/'+format.id,credentialRevision:'account-1'}};
    }};
    const host={now:Date.now,credentials:{read:async credential=>{assert.equal(credential,'account');return {revision:'account-1'};}},fetch:async(url,input)=>{
      assert.equal(new Headers(input.headers).get('Range'),'bytes=0-1023');const id=new URL(url).pathname.slice(1);reads.push(id);
      if(id===rejected)return new Response(null,{status:403});
      return new Response(new ReadableStream({start(c){c.enqueue(mp4Prefix());},cancel(){closed.push(id);}}),{status:206,headers:{'Content-Range':'bytes 0-1023/2048'}});
    }};
    const verified=await verifySearchPlayback(api,host,ref,{...options(),credentialRef:'account'},[audioMime(aac),audioMime(flac)]);
    assert.equal(verified.format.id,rejected===flac.id?aac.id:flac.id);assert.deepEqual(verified.ref,ref);
    assert.deepEqual(prepared.map(request=>request.formatId),rejected===flac.id?[flac.id,aac.id]:[flac.id]);
    assert.deepEqual(reads,prepared.map(request=>request.formatId));assert.deepEqual(closed,[verified.format.id]);
  }
});
test('desktop verification filters unsupported lossless formats before preparing or reading media',async()=>{
  const prepared=[],api={capabilities:()=>({operations:['formats']}),formats:async()=>[flac,aac],prepare:async request=>{
    prepared.push(request.formatId);assert.equal(request.formatId,aac.id);return playback;
  }};
  const host={now:Date.now,fetch:async()=>new Response(mp4Prefix(),{status:206,headers:{'Content-Range':'bytes 0-1023/2048'}})};
  assert.equal((await verifySearchPlayback(api,host,ref,options(),[audioMime(aac)])).format.id,aac.id);
  await assert.rejects(verifySearchPlayback(api,host,ref,options(),[]),{code:'unsupported'});assert.deepEqual(prepared,[aac.id]);
});
test('desktop rendition fallback stops on global failures and cancellation',async()=>{
  for(const code of ['network','authentication','rate-limited','upstream','cancelled']){
    const controller=new AbortController(),prepared=[];
    const api={capabilities:()=>({operations:['formats']}),formats:async()=>[flac,aac],prepare:async request=>{
      prepared.push(request.formatId);if(code==='cancelled')controller.abort();
      throw new MusicSourceError({code,provider:'bilibili',retryable:true});
    }};
    await assert.rejects(verifySearchPlayback(api,{now:Date.now,fetch:async()=>assert.fail('must not read')},ref,{signal:controller.signal},[audioMime(aac),audioMime(flac)]),error=>code==='cancelled'?error.name==='AbortError':error.code===code);
    assert.deepEqual(prepared,[flac.id]);
  }
});
test('a candidate is rejected only after every supported rendition has failed',async()=>{
  const prepared=[],api={capabilities:()=>({operations:['formats']}),formats:async()=>[aac,flac],prepare:async request=>{
    prepared.push(request.formatId);return {...playback,format:[aac,flac].find(format=>format.id===request.formatId)};
  }};
  await assert.rejects(verifySearchPlayback(api,{now:Date.now,fetch:async()=>new Response(null,{status:403})},ref,options(),[audioMime(aac),audioMime(flac)]),{code:'restricted'});
  assert.deepEqual(prepared,[flac.id,aac.id]);
});
test('prefix verification accumulates a complete bounded prefix; nonempty garbage and truncation are not success',async()=>{
  let cancelled=0;
  const host={now:Date.now,fetch:async()=>new Response(new ReadableStream({start(c){const prefix=mp4Prefix();c.enqueue(prefix.slice(0,3));c.enqueue(prefix.slice(3,300));c.enqueue(prefix.slice(300));},cancel(){cancelled++;}}),{status:206,headers:{'Content-Range':'bytes 0-1023/2048'}})};
  await verifySearchPlayback({prepare:async()=>playback},host,ref,options());assert.equal(cancelled,1);
  for(const [bytes,code]of [[new Uint8Array(1024),'unsupported'],[mp4Prefix().slice(0,128),'protocol']])await assert.rejects(verifySearchPlayback({prepare:async()=>playback},{now:Date.now,fetch:async()=>new Response(bytes,{status:206,headers:{'Content-Range':'bytes 0-1023/2048'}})},ref,options()),{code});
});
