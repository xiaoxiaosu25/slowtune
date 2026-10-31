import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build as viteBuild} from 'vite';
import {chromium} from '../tests/helpers/browser.mjs';
import {buildSourceBaseline,sourceBaselineService} from '../tests/helpers/source-baseline-service.mjs';
import {developmentPaths} from './workspace-paths.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),paths=developmentPaths(),stamp=Date.now(),real=process.argv.includes('--real'),smoke=process.argv.includes('--smoke'),qualityPreferences=process.argv.includes('--quality-preferences');
const healthySamples=smoke?1:Number(process.env.MUSIC_APP_SOURCE_BASELINE_SAMPLES??30),faultSamples=smoke?1:Number(process.env.MUSIC_APP_SOURCE_BASELINE_FAULT_SAMPLES??3);
const candidateRecovery=process.argv.includes('--candidate-recovery'),healthyOnly=process.argv.includes('--healthy-only');
assert(Number.isInteger(healthySamples)&&healthySamples>=1&&healthySamples<=200&&Number.isInteger(faultSamples)&&faultSamples>=1&&faultSamples<=10,'Invalid baseline sample count');
const output=resolve(process.env.MUSIC_APP_SOURCE_APP_OUTPUT??join(paths.artifacts,'source-app-baseline-'+stamp));
const runtime=join(paths.testRuntime,'source-app-baseline-'+stamp);
await mkdir(output,{recursive:false});await mkdir(runtime,{recursive:true});
const report={schemaVersion:1,createdAt:new Date().toISOString(),mode:real?'real-anonymous':'controlled',scope:'Actual product HTTP service, authentication, search/prepare/media routes and usePlayback composition in a test UI. No full application visual UX, Electron, speakers or existing accounts.',measurement:{healthySamples,faultSamples,playingObservation:'Native playing and media time greater than 0.1 seconds; polling and time advancement are included in elapsedMs.',pendingObservation:'Cancel after the held upstream request is observed; not a production timeout measurement.',cache:'New service/browser context per run; first controlled selection is cold and subsequent identical queries repeat with application caches. No OS/browser cache clearing.'},cases:[],shutdown:null,unverified:['Electron and physical output','Authenticated FLAC/Dolby permissions and decoding','Complete UI cross-client terminal facts and decode attribution','Long-duration continuity and final performance thresholds']};
const checkpoint=()=>writeFile(join(output,'report.partial.json'),JSON.stringify(report,null,2));
const quantiles=values=>{const rows=[...values].sort((a,b)=>a-b);return {samples:rows.length,p50Ms:rows.length?rows[Math.ceil(rows.length*.5)-1]:null,p95Ms:rows.length?rows[Math.ceil(rows.length*.95)-1]:null};};
const safePath=path=>path.replace(/^\/v1\/(media|leases)\/[^/]+/,'/v1/$1/:lease');
let browser,service;
try{
  const buildRoot=process.env.MUSIC_APP_SOURCE_APP_BUILD?resolve(process.env.MUSIC_APP_SOURCE_APP_BUILD):await buildSourceBaseline(join(paths.build,'source-app-baseline-'+stamp));
  report.buildRoot=buildRoot;
  try{report.buildBasis=JSON.parse(await readFile(join(buildRoot,'source-baseline-build.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;report.buildBasis={sourceCommit:null,note:'Explicit prebuilt input without a source-build record'};}
  report.fixedInput={productVersion:JSON.parse(await readFile(join(buildRoot,'package.json'),'utf8')).version,node:process.version,platform:process.platform,packages:Object.fromEntries(await Promise.all(['@studio/music-sources','@studio/player','@studio/lyrics'].map(async name=>[name,JSON.parse(await readFile(join(buildRoot,'node_modules',name,'package.json'),'utf8')).version])))};
  browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});report.browserVersion=browser.version();
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage();
  let audioFile;
  if(!real){
    const generated=await page.evaluate(async()=>{
      const audio=new AudioContext(),oscillator=audio.createOscillator(),destination=audio.createMediaStreamDestination();oscillator.connect(destination);await audio.resume();
      const recorder=new MediaRecorder(destination.stream,{mimeType:'audio/webm;codecs=opus'}),chunks=[];recorder.ondataavailable=event=>chunks.push(event.data);
      const finished=new Promise(done=>recorder.onstop=done);recorder.start();oscillator.start();await new Promise(done=>setTimeout(done,3500));recorder.stop();oscillator.stop();await finished;await audio.close();
      const data=new Uint8Array(await new Blob(chunks).arrayBuffer());return btoa(String.fromCharCode(...data));
    });
    audioFile=join(runtime,'synthetic-opus.webm');await writeFile(audioFile,Buffer.from(generated,'base64'));
  }
  service=await sourceBaselineService({buildRoot,runtime,mode:real?'real':'controlled',audioFile});
  const built=await viteBuild({configFile:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},build:{target:'esnext',write:false,minify:false,lib:{entry:join(root,'tests/helpers/source-playback-probe.tsx'),formats:['es']},rollupOptions:{output:{inlineDynamicImports:true}}}});
  const bundle=(Array.isArray(built)?built:[built]).flatMap(item=>item.output).find(item=>item.isEntry).code;
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==service.base)return route.abort();
    if(url.pathname==='/__s0/')return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div><script type="module" src="/__s0/probe.js"></script>'});
    if(url.pathname==='/__s0/probe.js')return route.fulfill({contentType:'text/javascript',body:bundle});
    return route.continue();
  });
  const api=async(path,body)=>{
    const response=await context.request.fetch(service.base+path,{method:body===undefined?'GET':'POST',headers:{'X-Music-App':'1','X-SlowTune-Surface':'desktop'},...(body===undefined?{}:{data:body}),timeout:30000});
    return {status:response.status(),data:await response.json()};
  };
  assert.equal((await api('/api/login',{accessKey:service.config.accessKey})).status,200);
  await page.goto(service.base+'/__s0/');await page.waitForFunction(()=>!!window.sourceBaseline);
  await page.evaluate(()=>{window.sourceMediaEvents=[];const audio=document.querySelector('audio');for(const type of ['playing','ended','error','waiting'])audio.addEventListener(type,()=>{window.sourceMediaEvents.push({type,at:Date.now(),position:audio.currentTime,mediaCode:audio.error?.code??null});if(window.sourceMediaEvents.length>200)window.sourceMediaEvents.shift();});});
  const call=(method,...args)=>page.evaluate(({method,args})=>window.sourceBaseline[method](...args),{method,args});
  const begin=(method,...args)=>page.evaluate(({method,args})=>{window.baselineTask=window.sourceBaseline[method](...args);},{method,args});
  const state=()=>page.evaluate(()=>{const a=document.querySelector('audio'),p=window.sourceBaseline;return {current:p.currentTrackId(),format:p.snapshot.format??null,position:a.currentTime,paused:a.paused,mediaCode:a.error?.code??null,preparing:p.preparing,errorPresent:!!p.error,elements:document.querySelectorAll('audio').length,records:p.records()};});
  let http=[];
  page.on('response',response=>{const url=new URL(response.url());if(!/^\/(api|v1)\//.test(url.pathname))return;http.push({path:safePath(url.pathname),status:response.status(),serverOperation:response.headers()['x-slowtune-operation']??null,at:Date.now()});});
  const settled=async()=>{for(let i=0;i<100;i++){const value=await api('/api/status');if(!value.data.sources.pending&&!value.data.delivery.activeReads&&!value.data.desktopPlayback.active&&!value.data.desktopPlayback.pending&&!value.data.desktopPlayback.inflight)return value.data;await new Promise(done=>setTimeout(done,30));}throw Error('Product work did not settle after cancellation');};
  async function measure(scenario,action,{expectPlaying=false,pending=false,naturalNext=false,pendingAction}={}){
    await call('stop');await settled();
    await service.rpc('set',{scenario,serial:report.cases.length+1});http=[];
    const before=await call('diagnostics'),lastAt=before.at(-1)?.at??0,started=Date.now();await page.evaluate(()=>{window.sourceMediaEvents=[];});
    await action();let observationError=null;
    try{if(pending){
      for(let n=0;n<100;n++){const snapshot=await service.rpc('snapshot');if(snapshot.events.some(event=>event.kind==='media'))break;await new Promise(done=>setTimeout(done,20));}
      if(pendingAction)await pendingAction();await call('cancelPending');await call('stop');
    }else if(expectPlaying){await page.waitForFunction(()=>{const a=document.querySelector('audio'),p=window.sourceBaseline;return !a.paused&&a.currentTime>.1||!!p.error&&!p.preparing;},undefined,{timeout:25000});if((await state()).errorPresent)observationError='ProductPlaybackError';}
    else await page.waitForFunction(()=>!!window.sourceBaseline.error&&!window.sourceBaseline.preparing,undefined,{timeout:20000});
    if(naturalNext){const first=(await state()).current;await page.waitForFunction(id=>{const audio=document.querySelector('audio');return window.sourceBaseline.currentTrackId()!==id&&!audio.paused&&audio.currentTime>.1;},first,{timeout:10000});}
    }catch(error){observationError=error.name;}
    const elapsedMs=Date.now()-started,observed=await state(),diagnostics=(await call('diagnostics')).filter(event=>event.at>lastAt);
    assert.equal(observed.elements,1);
    if(expectPlaying&&!observationError)assert.equal(observed.mediaCode,null);
    await call('stop');const status=await settled(),upstream=await service.rpc('snapshot');
    assert.equal(upstream.activeFetches,0);assert.equal(upstream.openBodies,0);
    const playing=diagnostics.find(event=>event.operation==='player'&&event.code==='playback-started'),first=upstream.events.find(event=>event.kind==='media'&&!event.probe&&event.firstBodyAt!==null);
    const mediaEvents=await page.evaluate(()=>window.sourceMediaEvents),ended=mediaEvents.find(event=>event.type==='ended'),nextPlaying=ended?mediaEvents.find(event=>event.type==='playing'&&event.at>=ended.at):null;
    const item={scenario,outcome:observationError?observationError==='ProductPlaybackError'?'product-error':'observation-timeout':expectPlaying?'playing':pending?'cancelled-by-observer':'product-error',observationError,elapsedMs,naturalTransition:naturalNext?{observed:!!ended&&!!nextPlaying,gapMs:nextPlaying?nextPlaying.at-ended.at:null}:null,timing:{playingMs:playing?playing.at-started:null,upstreamFirstBlockMs:first?first.firstBodyAt-started:null,firstBlockToPlayingMs:first&&playing?playing.at-first.firstBodyAt:null,preparations:diagnostics.filter(event=>event.operation==='source-prepare'&&event.code==='complete').map(event=>event.elapsedMs)},observed:{...observed,current:observed.current?'selection-present':null},http,diagnostics,mediaEvents,serverEvents:status.desktopPlayback.events.filter(event=>event.at>=started),upstream,resources:{leases:status.delivery.leases,reads:status.delivery.activeReads,pending:status.sources.pending,active:status.desktopPlayback.active,inflight:status.desktopPlayback.inflight,tickets:status.desktopPlayback.tickets}};
    report.cases.push(item);await checkpoint();console.log(JSON.stringify({scenario,outcome:item.outcome,elapsedMs}));if(observationError&&!real)throw Error('Baseline observation timed out: '+scenario);return item;
  }
  const synthetic={title:'基线测试歌曲',artists:['基线歌手']};
  if(!real){
    for(let i=0;i<healthySamples;i++)await measure('healthy',()=>begin('playChartItem',synthetic),{expectPlaying:true});
    if(!healthyOnly){
    for(const scenario of smoke?['probe-http429','delivery-http403','probe-headers-hang']:['probe-http403','probe-http412','probe-http429','probe-bad-range','delivery-http403','delivery-http429','delivery-truncated','probe-headers-hang','delivery-headers-hang','delivery-body-hang']){
      for(let n=0;n<faultSamples;n++)await measure(scenario,()=>begin('playChartItem',synthetic),{pending:scenario.endsWith('hang')&&!candidateRecovery,expectPlaying:scenario.endsWith('bad-range')||scenario.endsWith('hang')&&candidateRecovery});
    }
    if(smoke||candidateRecovery){
      report.manualRetry=await measure('delivery-http403',async()=>{
        await begin('playChartItem',synthetic);
        await page.waitForFunction(()=>!!window.sourceBaseline.error&&!window.sourceBaseline.preparing,undefined,{timeout:10000});
        await service.rpc('change',{scenario:'healthy'});await begin('retry');
      },{expectPlaying:true});
      assert.equal(report.manualRetry.http.filter(event=>event.path==='/v1/call/prepare').length,2,'Only the explicit retry may prepare again after a permission failure');
    }
    // The exact failed source and transport intent are validated through the real
    // service with the product's retry, rather than a mock prepare endpoint.
    await service.rpc('set',{scenario:'healthy',serial:report.cases.length+1});
    const metadata=await api('/v1/call/metadata',{protocol:2,ref:{provider:'bilibili',kind:'video',id:'BV1000000001'}});
    report.queue=await measure('queue-sequential',async()=>{await begin('playAll',metadata.data.result.parts);},{expectPlaying:true,naturalNext:true});
    if(!smoke)report.shuffleQueue=await measure('queue-shuffle',async()=>{await begin('playAll',metadata.data.result.parts);await call('cycleMode');},{expectPlaying:true,naturalNext:true});
    if(!smoke){
      report.lateSelection=await measure('probe-headers-hang',async()=>{
        await begin('playChartItem',synthetic);
        for(let n=0;n<100;n++){if((await service.rpc('snapshot')).events.some(event=>event.kind==='media'&&event.probe))break;await new Promise(done=>setTimeout(done,20));}
        await service.rpc('change',{scenario:'healthy'});await begin('play',metadata.data.result.parts[1]);
      },{expectPlaying:true});
      assert.equal(await page.evaluate(()=>window.sourceBaseline.snapshot.current?.ref.part==='902'),true,'Late search must not replace the new exact part');
      report.sessionRevocation=await measure('probe-headers-hang',()=>begin('playChartItem',synthetic),{pending:true,pendingAction:async()=>{assert.equal((await api('/api/logout',{})).status,200);assert.equal((await api('/api/login',{accessKey:service.config.accessKey})).status,200);}});
      const challenge=await api('/api/bilibili/login',{});assert.equal(challenge.status,200);
      const signed=await api('/api/bilibili/poll',{id:challenge.data.id});assert.equal(signed.data.state,'authenticated');
      report.accountRevocation=await measure('probe-headers-hang',()=>begin('playChartItem',synthetic),{pending:true,pendingAction:async()=>{assert.equal((await api('/api/bilibili/disconnect',{})).data.state,'anonymous');}});
      report.accountRevocation.scope='Synthetic login and DPAPI in isolated runtime only; account disconnect during held probe followed by explicit cancellation.';
    }
    }
    report.summary={healthy:quantiles(report.cases.filter(item=>item.scenario==='healthy').map(item=>item.elapsedMs)),otherAttempts:report.cases.filter(item=>item.scenario!=='healthy').length};
  }else{
    let inputs;
    if(process.env.MUSIC_APP_SOURCE_BASELINE_INPUT)inputs=JSON.parse(await readFile(process.env.MUSIC_APP_SOURCE_BASELINE_INPUT,'utf8'));
    else{
      const discovered=await api('/v1/call/search',{protocol:2,provider:'bilibili',request:{query:'音乐 纯音乐',mode:'video',limit:20}});
      assert.equal(discovered.status,200,'Anonymous sample discovery failed');
      inputs=[{provider:'bilibili',kind:'video',id:'BV118411B7XU'},...discovered.data.result.items.map(item=>item.ref)].filter((ref,index,all)=>all.findIndex(other=>other.id===ref.id)===index).slice(0,smoke?1:10);
    }
    assert(Array.isArray(inputs)&&inputs.length>0&&inputs.length<=20&&inputs.every(ref=>ref.provider==='bilibili'&&ref.kind==='video'&&/^BV[0-9A-Za-z]{10}$/.test(ref.id)),'Only a bounded list of stable Bilibili video references is accepted');
    await writeFile(join(runtime,'input-samples.json'),JSON.stringify(inputs,null,2));
    for(let index=0;index<inputs.length;index++){
      const metadata=await api('/v1/call/metadata',{protocol:2,ref:inputs[index]});
      if(metadata.status!==200){report.cases.push({scenario:'sample-'+(index+1),outcome:'metadata-failed',status:metadata.status,code:metadata.data.error?.code??null});continue;}
      const entry=metadata.data.result,formats=await api('/v1/call/formats',{protocol:2,ref:entry.ref});
      for(let n=0;n<(smoke?1:3);n++){
        const preference=qualityPreferences?['auto','compatible','economy'][n]:'auto';if(qualityPreferences)await call('setAudioPreference',preference);
        try{const item=await measure('sample-'+(index+1),()=>begin('play',entry),{expectPlaying:true});item.preference=preference;item.sourceFacts={durationSeconds:entry.durationSeconds,parts:entry.parts?.length??1,formats:formats.data.result??[]};}
        catch(error){await call('cancelPending');await call('stop');report.cases.push({scenario:'sample-'+(index+1),outcome:'playback-failed',error:typeof error.code==='string'?error.code:'observation-timeout',upstream:await service.rpc('snapshot')});await checkpoint();}
      }
    }
    report.summary={attempts:report.cases.length,playing:report.cases.filter(item=>item.outcome==='playing').length,successfulPlaying:quantiles(report.cases.filter(item=>item.outcome==='playing').map(item=>item.elapsedMs)),scope:'Anonymous exact-video playback; stable references stored only in the isolated input manifest. No FLAC/Dolby account claim, automatic matching benchmark or queue gap measurement.'};
  }
  await call('release');report.shutdown=await service.close();service=undefined;
  assert(Object.values(report.shutdown).every(value=>value===0),'Product shutdown must release owned work');
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log('Report: '+join(output,'report.json'));
}catch(error){report.failure={name:error.name,code:typeof error.code==='string'?error.code:null};await checkpoint();throw error;}
finally{await browser?.close();if(service)await service.close();}
