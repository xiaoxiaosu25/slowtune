import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {developmentPaths} from './workspace-paths.mjs';
import {chromium} from '../tests/helpers/browser.mjs';
import {mp4Prefix} from '../tests/fixtures/audio-prefix.mjs';

// S0 observes the installed product combination. No product configuration,
// account, database, global fetch, browser profile or playback policy is changed.
const root=fileURLToPath(new URL('..',import.meta.url));
const integer=(key,fallback,min,max)=>{
  const value=Number(process.env[key]??fallback);
  if(!Number.isInteger(value)||value<min||value>max)throw Error(`${key} must be ${min}..${max}`);
  return value;
};
const samples=integer('MUSIC_APP_SOURCE_BASELINE_SAMPLES',30,1,200);
const faultSamples=integer('MUSIC_APP_SOURCE_BASELINE_FAULT_SAMPLES',3,1,10);
const nativeTimeouts=process.argv.includes('--native-timeouts');
const deadlineMs=nativeTimeouts?65000:integer('MUSIC_APP_SOURCE_BASELINE_DEADLINE_MS',250,100,5000);
const output=resolve(process.env.MUSIC_APP_SOURCE_BASELINE_OUTPUT??join(developmentPaths().artifacts,'source-playback-baseline-'+Date.now()));
// A new directory is mandatory: never overwrite a prior report or user data.
await mkdir(dirname(output),{recursive:true});
await mkdir(output);
const product=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const installedVersion=async name=>{
  let directory=dirname(fileURLToPath(import.meta.resolve(name)));
  for(;;){
    try{const value=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));if(value.name===name)return value.version;}catch(error){if(error.code!=='ENOENT')throw error;}
    const parent=dirname(directory);if(parent===directory)throw Error('Cannot locate package '+name);directory=parent;
  }
};
const git=args=>{try{return execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();}catch{return null;}};
const sourceStatus=git(['status','--porcelain']),workingTree=sourceStatus===null?'unavailable':sourceStatus?'modified':'clean';
const bundle=await build({stdin:{contents:"export {PlaybackDelivery} from './server/playback-delivery.ts'; export {verifySearchPlayback} from './server/search-playback.ts'; export {audioMime} from './server/audio-quality.ts';",resolveDir:root},bundle:true,platform:'node',format:'esm',write:false});
const {PlaybackDelivery,verifySearchPlayback,audioMime}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const ref={provider:'bilibili',kind:'video',id:'BV1000000001',part:'901'};
const aac={id:'30280',codec:'mp4a.40.2',mimeType:'audio/mp4',container:'mp4',bitrate:128000};
const flac={id:'30251',codec:'fLaC',mimeType:'audio/mp4',container:'mp4',bitrate:1000000};
const entry={ref,resourceId:'synthetic-baseline',title:'Synthetic source baseline',durationSeconds:3};
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const round=value=>Math.round(value*100)/100;
const failure=error=>error?.code&&typeof error.code==='string'?error.code:error?.name==='TimeoutError'?'timeout':error?.name==='AbortError'?'cancelled':'network';
const stats=values=>{
  if(!values.length)return {samples:0,p50Ms:null,p95Ms:null};
  const ordered=[...values].sort((a,b)=>a-b);
  return {samples:ordered.length,p50Ms:round(ordered[Math.ceil(ordered.length*.5)-1]),p95Ms:round(ordered[Math.ceil(ordered.length*.95)-1])};
};
const summarize=rows=>({attempts:rows.length,successes:rows.filter(row=>row.outcome==='ok').length,failures:rows.filter(row=>row.outcome!=='ok').length,timeouts:rows.filter(row=>row.outcome==='timeout').length,cancellations:rows.filter(row=>row.outcome==='cancelled').length,allAttempts:stats(rows.map(row=>row.elapsedMs)),successfulAttempts:stats(rows.filter(row=>row.outcome==='ok').map(row=>row.elapsedMs)),consumerHeaders:stats(rows.flatMap(row=>row.headersMs===null?[]:[row.headersMs])),consumerFirstBody:stats(rows.flatMap(row=>row.firstBodyMs===null?[]:[row.firstBodyMs])),upstreamHeaders:stats(rows.flatMap(row=>row.requests.flatMap(request=>request.headersMs===null?[]:[request.headersMs]))),upstreamFirstBlock:stats(rows.flatMap(row=>row.requests.flatMap(request=>request.firstBodyMs===null?[]:[request.firstBodyMs])))});

function sourceFixture(scenario,started){
  const facts={requests:[],events:[],preparations:[],activeFetches:0,openBodies:0,peakBodies:0,bodyBytes:0};
  let revision='synthetic-1';
  const playback=format=>({resourceId:entry.resourceId,entry,format,delivery:{url:'https://primary.bilivideo.com/'+format.id,alternatives:['https://backup.bilivideo.com/'+format.id],headers:{Referer:'https://www.bilibili.com/'},requiresHost:true,...(scenario==='expired'?{expiresAt:0}:{}),...(scenario==='account-change'?{credentialRevision:revision}:{})}});
  const api={capabilities:()=>({operations:['formats','prepare']}),formats:async()=>scenario==='restricted-format'?[flac,aac]:[aac],prepare:async request=>{
    const format=request.formatId===flac.id?flac:aac;facts.preparations.push(format.id);return playback(format);
  }};
  const hang=signal=>new Promise((_,reject)=>{
    const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
  function body(mode,signal,request){
    let controller,closed=false,step=0;
    facts.openBodies++;facts.peakBodies=Math.max(facts.peakBodies,facts.openBodies);
    const close=()=>{if(closed)return;closed=true;facts.openBodies--;signal.removeEventListener('abort',abort);};
    const abort=()=>{if(!closed){controller.error(signal.reason);close();}};
    return new ReadableStream({start(value){controller=value;signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();},pull(value){
      if(closed||mode==='body-hang')return;
      if(mode==='interrupted'&&step++>0){value.error(new TypeError('Synthetic body interruption'));close();return;}
      const bytes=mode==='truncated'?mp4Prefix().slice(0,128):mode==='interrupted'?mp4Prefix().slice(0,512):mp4Prefix();
      request.firstBodyMs??=round(performance.now()-started);facts.bodyBytes+=bytes.byteLength;value.enqueue(bytes);
      if(mode!=='interrupted'){value.close();close();}
    },cancel(){close();}});
  }
  const host={now:Date.now,onDiagnostic:event=>{
    // Explicit projection: no host, URL, raw range, lease, entry or error text.
    facts.events.push({code:event.code,attempt:event.attempt??null,status:event.status??null,errorCode:event.errorCode??null,atMs:round(performance.now()-started)});
  },credentials:{read:async()=>({revision})},fetch:async(input,init)=>{
    const url=new URL(input),slot=url.hostname==='primary.bilivideo.com'?'primary':url.hostname==='backup.bilivideo.com'?'backup':'untrusted';
    assert.notEqual(slot,'untrusted','Fixture must never access a real upstream');
    const request={slot,formatId:url.pathname.slice(1),headersMs:null,firstBodyMs:null};facts.requests.push(request);facts.activeFetches++;
    try{
      if(scenario==='headers-hang'&&slot==='primary'||scenario==='cancel'||scenario==='deadline')return await hang(init.signal);
      if(scenario==='network-fallback'&&slot==='primary')throw new TypeError('Synthetic connection failure');
      let status=206;
      if(/^http-/.test(scenario))status=Number(scenario.slice(5));
      if(scenario==='restricted-format'&&request.formatId===flac.id)status=403;
      request.headersMs=round(performance.now()-started);
      if(status!==206)return new Response(null,{status,headers:status===429?{'Retry-After':'2'}:{}});
      const headers={'Content-Range':scenario==='bad-range'?'bytes 1-1024/2048':'bytes 0-1023/2048','Content-Length':'1024','Content-Type':'audio/mp4'};
      const response=new Response(body(scenario==='body-hang'&&slot==='backup'?'healthy':scenario,init.signal,request),{status,headers});
      return response;
    }finally{facts.activeFetches--;}
  }};
  return {api,host,facts,playback,changeAccount:()=>{revision='synthetic-2';}};
}

async function sourceAttempt(path,scenario){
  const started=performance.now(),fixture=sourceFixture(scenario,started),stop=new AbortController();
  const {facts}=fixture;
  let delivery,published,response,reader,headersMs=null,firstBodyMs=null,bytes=0,outcome='ok',sourceFailureCode=null,retryAfterMs=null,timer;
  const cancel=scenario==='cancel',deadline=scenario==='deadline';
  timer=setTimeout(()=>stop.abort(new DOMException('Synthetic operation deadline',cancel?'AbortError':'TimeoutError')),cancel||deadline?40:deadlineMs);
  try{
    if(path==='search-probe'){
      await verifySearchPlayback(fixture.api,fixture.host,ref,{signal:stop.signal,...(scenario==='account-change'?{credentialRef:'synthetic'}:{})},[audioMime(aac),audioMime(flac)],undefined,()=>{if(scenario==='account-change')fixture.changeAccount();return true;});
    }else{
      delivery=new PlaybackDelivery(fixture.host);delivery.desktopContext=()=>true;
      const options=scenario==='account-change'?{credentialRef:'synthetic'}:{};
      published=await delivery.publish(fixture.playback(scenario==='restricted-format'?flac:aac),'http://localhost',options);
      if(scenario==='account-change')fixture.changeAccount();
      response=await delivery.read(published.leaseId,new Request(published.delivery.url,{headers:{Range:'bytes=0-1023'},signal:stop.signal}),options);
      headersMs=round(performance.now()-started);reader=response.body?.getReader();
      while(reader){const chunk=await reader.read();if(chunk.done)break;if(chunk.value.byteLength){firstBodyMs??=round(performance.now()-started);bytes+=chunk.value.byteLength;}}
    }
  }catch(error){sourceFailureCode=failure(error);outcome=stop.signal.aborted?failure(stop.signal.reason):sourceFailureCode;retryAfterMs=error.retryAfterMs??null;}
  finally{
    clearTimeout(timer);await reader?.cancel().catch(()=>{});await delivery?.dispose();
  }
  const elapsedMs=round(performance.now()-started);
  // The probe deliberately owns a private MediaDelivery. Count the fixture's
  // active fetches/bodies; do not pretend its private lease map was observed.
  assert.equal(facts.activeFetches,0,`${path}/${scenario}: active upstream fetch`);
  assert.equal(facts.openBodies,0,`${path}/${scenario}: unreleased response body`);
  const resources=delivery?delivery.diagnostics():null;
  if(resources){assert.equal(resources.activeReads,0);assert.equal(resources.leases,0);}
  return {outcome,sourceFailureCode,externalSignalReason:stop.signal.aborted?failure(stop.signal.reason):null,responseCommitted:path==='search-probe'?null:!!response,elapsedMs,headersMs,firstBodyMs,consumerBytes:path==='search-probe'?null:bytes,retryAfterMs,preparations:facts.preparations,requests:facts.requests,events:facts.events,upstreamBodyBytes:facts.bodyBytes,resources:{activeFetches:facts.activeFetches,openBodies:facts.openBodies,peakBodies:facts.peakBodies,delivery:resources}};
}

function tone(){
  const rate=16000,seconds=3,bytes=Buffer.alloc(44+rate*seconds*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
  for(let i=0;i<rate*seconds;i++)bytes.writeInt16LE(Math.round(1000*Math.sin(i*2*Math.PI*440/rate)),44+i*2);
  return bytes;
}

async function browserBaseline(){
  const audioBytes=tone(),connections=new Set(),serverFacts=new Map();
  const server=createServer((request,response)=>{
    const url=new URL(request.url,'http://localhost');
    if(url.pathname==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Source playback baseline</title><audio preload="none"></audio>');return;}
    const mode=url.pathname.slice(1),attempt=url.searchParams.get('attempt');
    const fact=serverFacts.get(attempt);if(!fact){response.writeHead(404);response.end();return;}
    fact.requests++;
    if(mode==='stall'){request.on('close',()=>{fact.cancelled++;});return;}
    fact.headersMs??=round(performance.now()-fact.started);
    if(mode.startsWith('http-')){response.writeHead(Number(mode.slice(5)),{'Content-Type':'application/json'});response.end('{"error":{"code":"synthetic"}}');return;}
    const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range??''),start=Number(range?.[1]??0),end=range?.[2]?Math.min(Number(range[2]),audioBytes.length-1):audioBytes.length-1;
    if(start>=audioBytes.length){response.writeHead(416,{'Content-Range':`bytes */${audioBytes.length}`});response.end();return;}
    const bytes=mode==='undecodable'?Buffer.alloc(audioBytes.length):audioBytes;
    response.writeHead(range?206:200,{'Content-Type':'audio/wav','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${audioBytes.length}`}:{})});
    fact.firstBodyMs??=round(performance.now()-fact.started);
    if(mode==='truncated'){const part=bytes.subarray(start,Math.min(end+1,start+20));fact.bytes+=part.length;response.write(part);setTimeout(()=>response.destroy(),20);return;}
    fact.bytes+=end-start+1;
    response.end(bytes.subarray(start,end+1));
  });
  server.on('connection',socket=>{connections.add(socket);socket.once('close',()=>connections.delete(socket));});
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  const base='http://127.0.0.1:'+server.address().port;
  let browser;
  const reports=[];
  try{
    browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
    const context=await browser.newContext();
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage();await page.goto(base);
    const capabilities=await page.evaluate(()=>Object.fromEntries(['audio/wav; codecs="pcm"','audio/mp4; codecs="mp4a.40.2"','audio/mp4; codecs="fLaC"','audio/mp4; codecs="ec-3"'].map(type=>[type,document.querySelector('audio').canPlayType(type)])));
    for(const mode of ['healthy','undecodable','http-403','http-412','http-429','truncated','stall']){
      const rows=[];
      for(let index=0;index<(mode==='healthy'?samples:faultSamples);index++){
        const attempt='native-'+reports.length+'-'+index,fact={started:performance.now(),requests:0,headersMs:null,firstBodyMs:null,bytes:0,cancelled:0};serverFacts.set(attempt,fact);
        const row=await page.evaluate(async({mode,attempt})=>{
          const audio=document.querySelector('audio'),started=performance.now(),events=[];
          let playingMs=null,advanceMs=null,rejection=null;
          const record=event=>{if(event.type==='playing')playingMs??=performance.now()-started;events.push({type:event.type,atMs:performance.now()-started,position:audio.currentTime,mediaCode:audio.error?.code??null});};
          const types=['loadstart','loadedmetadata','playing','waiting','stalled','error'];types.forEach(type=>audio.addEventListener(type,record));
          audio.src='/'+mode+'?attempt='+attempt;void audio.play().catch(error=>{rejection=error.name;});
          const until=performance.now()+1500;
          while(performance.now()<until&&!audio.error){if(audio.currentTime>.05){advanceMs=performance.now()-started;break;}await new Promise(done=>setTimeout(done,10));}
          const result={elapsedMs:performance.now()-started,playingMs,advanceMs,mediaCode:audio.error?.code??null,playRejection:rejection,position:audio.currentTime,events,mediaElements:document.querySelectorAll('audio').length};
          types.forEach(type=>audio.removeEventListener(type,record));audio.pause();audio.removeAttribute('src');audio.load();return result;
        },{mode,attempt});
        assert.equal(row.mediaElements,1);
        if(mode==='healthy')assert(row.advanceMs!==null,'Healthy native media must actually advance');
        else assert(row.advanceMs===null,'Fault fixture unexpectedly played');
        rows.push({...row,outcome:row.advanceMs!==null?'ok':row.mediaCode?'media-error':'observation-deadline',server:{requests:fact.requests,headersMs:fact.headersMs,firstBodyMs:fact.firstBodyMs,bytes:fact.bytes}});
        serverFacts.delete(attempt);
      }
      reports.push({scenario:mode,summary:{attempts:rows.length,mediaCodes:[...new Set(rows.map(row=>row.mediaCode))],playing:stats(rows.flatMap(row=>row.playingMs===null?[]:[row.playingMs])),advance:stats(rows.flatMap(row=>row.advanceMs===null?[]:[row.advanceMs]))},rows});
      console.log(JSON.stringify({path:'native-element',scenario:mode,samples:rows.length,mediaCodes:reports.at(-1).summary.mediaCodes}));
    }
    return {browserVersion:browser.version(),capabilities,cases:reports,scope:'Single native audio element in an isolated browser context, synthetic WAV and local HTTP only; not the product player, Electron, Bilibili decoding or speaker output.'};
  }finally{await browser?.close();for(const socket of connections)socket.destroy();await new Promise(done=>server.close(done));}
}

const report={schemaVersion:1,createdAt:new Date().toISOString(),scope:'S0 controlled component baseline; in-memory bundles of product adapters and installed fixed packages. No full app routes, accounts or real upstream requests.',baseline:{productVersion:product.version,productCommit:git(['rev-parse','HEAD']),workingTree,node:process.version,platform:process.platform,arch:process.arch,packages:Object.fromEntries(await Promise.all(['@studio/music-sources','@studio/player','@studio/lyrics','electron'].map(async name=>[name,await installedVersion(name)]))),desktopReadTimeouts:new PlaybackDelivery({now:Date.now,fetch:async()=>{throw Error('No upstream');}}).desktopReadTimeouts},measurement:{samples,faultSamples,timeoutMode:nativeTimeouts?'unmodified-product-timeouts':'external-deadline-clamped',externalDeadlineMs:deadlineMs,cache:'New fixture and delivery instance per component attempt; new isolated browser context for native observations. OS/browser caches are not cleared.'},componentCases:[],native:null,unverified:['Full application /api/search/resolve and playback flow','Real Bilibili video/format samples and account permissions','Electron runtime, physical output, sleep and mobile background','Preparation/click-to-playing, natural queue transitions and prefetch benefits','Production failure attribution port; no runtime classifier added','Real-duration performance thresholds and four-hour continuous playback']};
const checkpoint=()=>writeFile(join(output,'report.partial.json'),JSON.stringify(report,null,2));
try{
  for(const scenario of ['healthy','network-fallback','headers-hang','body-hang','http-403','http-412','http-429','bad-range','truncated','interrupted','expired','account-change','cancel','deadline','restricted-format']){
    for(const path of ['search-probe','desktop-delivery']){
      const rows=[];
      for(let index=0;index<(scenario==='healthy'?samples:faultSamples);index++)rows.push(await sourceAttempt(path,scenario));
      report.componentCases.push({path,scenario,summary:summarize(rows),rows});await checkpoint();
      console.log(JSON.stringify({path,scenario,...summarize(rows)}));
    }
  }
  report.native=await browserBaseline();
  const undecodable=report.native.cases.find(row=>row.scenario==='undecodable').summary.mediaCodes.filter(value=>value!==null);
  report.native.ambiguousFailures=report.native.cases.filter(row=>row.scenario.startsWith('http-')||row.scenario==='truncated').filter(row=>row.summary.mediaCodes.some(code=>undecodable.includes(code))).map(row=>row.scenario);
  report.native.attributionConclusion=report.native.ambiguousFailures.length?'Native error codes overlap for undecodable content and transfer failures; automatic decode exclusion needs current-request delivery facts.':'This browser run did not prove an overlapping code. Native codes alone remain insufficient evidence for automatic codec exclusion.';
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
  console.log('Report: '+join(output,'report.json'));
}catch(error){report.failure={code:failure(error),name:error.name};await checkpoint();throw error;}
