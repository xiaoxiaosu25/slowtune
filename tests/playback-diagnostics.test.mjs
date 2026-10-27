import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
const bundle=await build({stdin:{contents:"export * from './src/playback-diagnostics.ts'; export * from './src/source-client.ts'; export {request} from './src/api.ts';",resolveDir:resolve('.')},bundle:true,platform:'node',format:'esm',write:false});
const diagnostics=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const {recordPlaybackDiagnostic,playbackDiagnostics,tracePlaybackApi,invokingPlaybackOperation,withPlaybackDiagnostic,connectSourceClient}=diagnostics;
const desktop=task=>async()=>{const previous=globalThis.window;globalThis.window={matchMedia:()=>({matches:true}),dispatchEvent:()=>{}};try{await task();}finally{globalThis.window=previous;}};
const gate=()=>{let release;return {promise:new Promise(resolve=>{release=resolve;}),release};};

test('diagnostics retain only bounded safe facts, redact lease paths, and reject untrusted server IDs',desktop(async()=>{
  for(let n=0;n<130;n++)recordPlaybackDiagnostic({operation:'player',code:'media-error',at:n,operationId:'playback-1',reason:'fallback',recovery:'limit',timeoutSeconds:30,positionSeconds:120,paused:true,mediaCode:2,url:'https://private.invalid/token',resourceId:'private-song',error:'secret'});
  const events=playbackDiagnostics();assert.equal(events.length,120);assert.equal(events[0].at,10);assert(!JSON.stringify(events).includes('private'));assert(!JSON.stringify(events).includes('secret'));
  events[0].code='changed';assert.equal(playbackDiagnostics()[0].code,'media-error');
  diagnostics.observeSourceRequest('/v1/leases/private-token?secret=one',new Response(null,{headers:{'X-SlowTune-Operation':'private-account'}}),performance.now());
  assert.equal(playbackDiagnostics().at(-1).operation,'/v1/leases/:lease');assert.equal(playbackDiagnostics().at(-1).serverOperation,undefined);
}));

test('overlapping source invocations retain their own IDs and late lease release retains the original owner',desktop(async()=>{
  const held=gate(),seen=[];let current='playback-2',serial=0;
  const api=tracePlaybackApi({prepare:async()=>{seen.push(invokingPlaybackOperation());const leaseId='private-lease-'+ ++serial;await held.promise;return {leaseId};},release:async()=>{seen.push(invokingPlaybackOperation());}},()=>current);
  const first=api.prepare({});current='playback-3';const second=api.prepare({});await new Promise(setImmediate);assert.deepEqual(seen,['playback-2','playback-3']);assert.equal(invokingPlaybackOperation(),undefined);
  held.release();const [left,right]=await Promise.all([first,second]);await api.release(left.leaseId);assert.equal(seen.at(-1),'playback-2');await api.release(right.leaseId);assert.equal(seen.at(-1),'playback-3');
  let owner='playback-4';const late=tracePlaybackApi({prepare:async()=>({leaseId:'late-private'}),release:async()=>assert.equal(invokingPlaybackOperation(),'playback-4')},()=>owner);
  await late.prepare({});owner='playback-5';await late.release('late-private');
  const optimized=tracePlaybackApi({prepareDesktopAudio:async()=>{assert.equal(invokingPlaybackOperation(),'playback-8');return{leaseId:'optimized-private'};},release:async()=>assert.equal(invokingPlaybackOperation(),'playback-8')},()=>owner);
  owner='playback-8';await optimized.prepareDesktopAudio({});owner='playback-9';await optimized.release('optimized-private');
  const signal=new AbortController().signal,scope=[];
  const quality=tracePlaybackApi({formats:async()=>scope.push(invokingPlaybackOperation()),prepare:async()=>scope.push(invokingPlaybackOperation())},()=>owner);
  await withPlaybackDiagnostic('playback-11',()=>quality.formats({}, {signal}));owner='playback-12';
  await quality.prepare({}, {signal});assert.deepEqual(scope,['playback-11','playback-11'],'format selection and preparation share their captured owner across awaits');
  assert(!JSON.stringify(playbackDiagnostics()).includes('private-lease'));assert(!JSON.stringify(playbackDiagnostics()).includes('late-private'));
}));

test('song and chart HTTP preflight retain their selection context on success and network failure',desktop(async()=>{
  const previous=globalThis.fetch;
  try{
    globalThis.fetch=async()=>Response.json({entry:{}},{headers:{'X-SlowTune-Operation':'desktop-11'}});
    await withPlaybackDiagnostic('playback-13',()=>diagnostics.request('/api/song-library/playback',{}));
    let last=playbackDiagnostics().at(-1);assert.equal(last.operationId,'playback-13');assert.equal(last.serverOperation,'desktop-11');assert.match(last.requestId,/^request-/);
    globalThis.fetch=async()=>{throw Error('private failure');};
    await assert.rejects(withPlaybackDiagnostic('playback-14',()=>diagnostics.request('/api/search/resolve',{})),{code:'network'});
    last=playbackDiagnostics().at(-1);assert.equal(last.operationId,'playback-14');assert.equal(last.errorCode,'network');assert.equal(last.code,'failure');
  }finally{globalThis.fetch=previous;}
}));

test('source fetch records network failure and cancellation before headers with captured invocation context',desktop(async()=>{
  const previous=globalThis.fetch;let mode='normal';
  globalThis.fetch=async(input,options)=>{
    if(String(input).endsWith('/handshake'))return Response.json({protocol:2,capabilities:[{provider:'bilibili',operations:['metadata'],anonymous:true,limitations:[]}]});
    if(mode==='network')throw Error('private network text');
    return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  };
  try{
    const client=await connectSourceClient('http://fixture',new AbortController().signal),ref={provider:'bilibili',kind:'video',id:'BV1000000001'};
    mode='network';await assert.rejects(withPlaybackDiagnostic('playback-6',()=>client.metadata(ref)),{code:'network'});
    let last=playbackDiagnostics().at(-1);assert.equal(last.operationId,'playback-6');assert.equal(last.errorCode,'network');assert.equal(last.code,'failure');assert.match(last.requestId,/^request-/);
    mode='cancel';const stop=new AbortController(),pending=withPlaybackDiagnostic('playback-7',()=>client.metadata(ref,{signal:stop.signal}));stop.abort();await assert.rejects(pending,{code:'cancelled'});
    last=playbackDiagnostics().at(-1);assert.equal(last.operationId,'playback-7');assert.equal(last.code,'cancelled');assert.equal(last.errorCode,'cancelled');assert(!JSON.stringify(playbackDiagnostics()).includes('private network text'));
    const deadline=new AbortController(),timed=withPlaybackDiagnostic('playback-10',()=>client.metadata(ref,{signal:deadline.signal}));deadline.abort(new DOMException('private timeout text','TimeoutError'));await assert.rejects(timed,{code:'cancelled'});
    last=playbackDiagnostics().at(-1);assert.equal(last.code,'failure');assert.equal(last.errorCode,'timeout');assert.equal(last.operationId,'playback-10');
  }finally{globalThis.fetch=previous;}
}));
