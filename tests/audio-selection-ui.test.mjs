import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium} from './helpers/browser.mjs';
import {sourceBaselineService} from './helpers/source-baseline-service.mjs';
import {developmentPaths} from '../scripts/workspace-paths.mjs';
import {startSongManagementFixture} from './helpers/song-management-fixture.mjs';
import {navigate} from '../scripts/browser-ui.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
test('audio selection uses actual HTTP preparation, one media element, selection snapshots and native continuity on desktop and mobile',{timeout:180000},async t=>{
  const paths=developmentPaths(),outputRoot=process.env.MUSIC_APP_AUDIO_QUALITY_OUTPUT??paths.artifacts;await mkdir(outputRoot,{recursive:true});const output=await mkdtemp(join(outputRoot,'audio-selection-')),runtime=join(output,'runtime');await mkdir(runtime);
  const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});let service;const report={scope:'Actual isolated service and usePlayback with product audio controls; synthetic AAC, declared fixture renditions, no FLAC/Dolby decoding or physical output claim',cases:[],shutdown:null};
  t.after(async()=>{try{if(service)report.shutdown=await service.close();}finally{await browser.close();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log('Audio selection evidence: '+output);}});
  const recorderPage=await browser.newPage();const encoded=await recorderPage.evaluate(async()=>{const context=new AudioContext({sampleRate:48000}),oscillator=context.createOscillator(),destination=context.createMediaStreamDestination();oscillator.connect(destination);await context.resume();const recorder=new MediaRecorder(destination.stream,{mimeType:'audio/mp4;codecs=mp4a.40.2',audioBitsPerSecond:128000}),chunks=[];recorder.ondataavailable=event=>chunks.push(event.data);const stopped=new Promise(done=>recorder.onstop=done);recorder.start();oscillator.start();await new Promise(done=>setTimeout(done,6500));recorder.stop();oscillator.stop();await stopped;await context.close();const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);});await recorderPage.close();const audioFile=join(runtime,'synthetic-aac.m4a');await writeFile(audioFile,Buffer.from(encoded,'base64'));
  service=await sourceBaselineService({buildRoot:resolve(process.env.MUSIC_APP_TEST_BUILD??root),runtime,audioFile,quality:true});
  const result=await build({configFile:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},build:{target:'esnext',write:false,minify:false,lib:{entry:join(root,'tests/helpers/audio-selection-probe.tsx'),formats:['es']},rollupOptions:{output:{inlineDynamicImports:true}}}}),files=(Array.isArray(result)?result:[result]).flatMap(item=>item.output),bundle=files.find(item=>item.isEntry).code,css=files.filter(item=>item.type==='asset'&&item.fileName.endsWith('.css')).map(item=>item.source).join('\n');
  let serial=0;
  for(const [surface,width] of [['desktop',1440],['mobile',390]])await t.test(surface,async surfaceTest=>{
    const context=await browser.newContext({viewport:{width,height:900}});surfaceTest.after(()=>context.close());const page=await context.newPage();page.setDefaultTimeout(12000);const issues=[];page.on('pageerror',error=>issues.push(error.name));
    await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==service.base)return route.abort();if(url.pathname==='/__quality/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/__quality/probe.css"><div id="root"></div><script type="module" src="/__quality/probe.js"></script>'});if(url.pathname==='/__quality/probe.js')return route.fulfill({contentType:'text/javascript',body:bundle});if(url.pathname==='/__quality/probe.css')return route.fulfill({contentType:'text/css',body:css});return route.continue();});
    const response=await context.request.post(service.base+'/api/login',{headers:{'X-Music-App':'1'},data:{accessKey:service.config.accessKey}});assert.equal(response.status(),200);await page.goto(service.base+'/__quality/');await page.waitForFunction(()=>!!window.qualityProbe);
    const invoke=(name,...args)=>page.evaluate(({name,args})=>window.qualityProbe[name](...args),{name,args}),begin=(name,...args)=>page.evaluate(({name,args})=>{window.qualityTask=window.qualityProbe[name](...args);},{name,args});
    const state=()=>page.evaluate(()=>{const p=window.qualityProbe,a=document.querySelector('audio');return {format:p.snapshot.format?.id,selection:p.snapshot.audioSelection,preference:p.audioPreference,part:p.snapshot.current?.ref.part,current:p.snapshot.currentId,time:a.currentTime,paused:a.paused,volume:a.volume,rate:a.playbackRate,muted:a.muted,sleepRemaining:p.sleep.remainingItems,ready:a.readyState,error:!!p.error,preparing:p.preparing,elements:document.querySelectorAll('audio').length};});
    const playing=()=>page.waitForFunction(()=>{const a=document.querySelector('audio');return !a.paused&&a.currentTime>.1;});
    const scenario=async name=>service.rpc('set',{scenario:name,serial:++serial});
    const until=async predicate=>{for(let attempt=0;attempt<150;attempt++){if(predicate(await service.rpc('snapshot')))return;await new Promise(done=>setTimeout(done,20));}throw Error('Upstream phase not observed');};
    const synthetic={title:'基线测试歌曲',artists:['基线歌手']};
    await scenario('healthy');await page.getByRole('combobox',{name:'默认音质'}).selectOption('economy');await begin('playChartItem',synthetic);await playing();assert.equal((await state()).format,'30216');
    const initial=await service.rpc('snapshot');assert(initial.events.some(event=>event.probe&&event.formatId==='30216')||surface==='mobile');assert(initial.events.filter(event=>event.kind==='media'&&!event.probe).every(event=>event.formatId==='30216'));
    await page.getByRole('combobox',{name:'默认音质'}).selectOption('auto');const mediaCount=initial.events.filter(event=>event.kind==='media').length;await page.waitForTimeout(150);assert.equal((await state()).format,'30216');assert.equal((await service.rpc('snapshot')).events.filter(event=>event.kind==='media').length,mediaCount);
    await page.waitForFunction(()=>document.querySelector('audio').currentTime>1.1);await invoke('toggle');await invoke('volume',.25);await invoke('rate',1.25);await invoke('mute');await invoke('startSleep',{trigger:{type:'items',count:3},action:'pause'});const before=await state();assert(before.paused);await page.getByRole('button',{name:'音质与音轨',exact:true}).click();const dialog=page.getByRole('dialog',{name:'音质与音轨'});await dialog.getByRole('option',{name:/192 kbps/}).waitFor({state:'attached'});
    assert((await dialog.innerText()).includes('48 kHz'));assert((await dialog.innerText()).includes('2 声道'));
    await dialog.getByRole('combobox',{name:'本次播放选择'}).selectOption('preference:compatible');await dialog.getByRole('button',{name:'应用到当前曲'}).click();await page.waitForFunction(()=>window.qualityProbe.snapshot.format?.id==='30280'&&document.querySelector('audio').readyState>=2);const changed=await state();assert.equal(changed.current,before.current);assert.equal(changed.part,before.part);assert(changed.paused);assert(changed.time>=before.time-.15);assert.equal(changed.selection.preference,'compatible');for(const key of ['volume','rate','muted','sleepRemaining'])assert.equal(changed[key],before[key],key+' must survive audio switching');
    await dialog.getByRole('combobox',{name:'本次播放选择'}).selectOption('format:30232');await dialog.getByRole('button',{name:'应用到当前曲'}).click();await page.waitForFunction(()=>window.qualityProbe.snapshot.format?.id==='30232'&&!window.qualityProbe.preparing);assert.equal((await state()).selection.formatId,'30232');assert.equal((await state()).preference,'auto');
    for(let cycle=0;cycle<100;cycle++){const formatId=cycle%2?'30232':'30280';assert.equal(await invoke('changeAudio',{preference:'auto',formatId}),true);await page.waitForFunction(position=>{const a=document.querySelector('audio');return a.readyState>=2&&a.currentTime>=position-.15&&a.paused;},before.time);assert.equal((await state()).elements,1);}
    const bounded=await invoke('records');assert.equal(bounded.tracks,1);assert.equal(bounded.preparing,0);assert(bounded.aliases<=2&&bounded.committed<=2);
    const still=await state();assert.equal(await invoke('changeAudio',{preference:'auto',formatId:'missing'}),false);assert.equal((await state()).format,'30232');assert.equal((await state()).current,still.current);
    await dialog.getByRole('button',{name:'关闭',exact:true}).click();
    const candidateReleased=()=>page.waitForResponse(response=>
      response.request().method()==='DELETE'&&new URL(response.url()).pathname.startsWith('/v1/leases/')&&response.status()===204);
    await page.evaluate(()=>{window.audioBeforeRejectedSwitch=document.querySelector('audio').currentSrc;});
    for(const [name,status] of [['probe-http403',403],['probe-http429',429],['probe-html',206]]){
      await scenario(name);
      const [,applied]=await Promise.all([candidateReleased(),invoke('changeAudio',{preference:'compatible'})]);
      assert.equal(applied,false);
      const denied=await state();
      assert(denied.error);
      assert(denied.paused);
      assert.equal(denied.current,still.current);
      assert.equal(denied.format,still.format);
      assert.deepEqual(denied.selection,still.selection);
      assert(Math.abs(denied.time-still.time)<.15);
      assert(await page.evaluate(()=>document.querySelector('audio').currentSrc===window.audioBeforeRejectedSwitch));
      const reads=(await service.rpc('snapshot')).events.filter(event=>event.kind==='media'&&event.formatId==='30280');
      assert.deepEqual(reads.map(event=>[event.probe,event.status]),[[true,status]]);
    }
    await invoke('setAudioPreference','economy');await scenario('healthy');
    assert.equal(await invoke('changeAudio',{preference:'compatible'}),true);
    await page.waitForFunction(()=>window.qualityProbe.snapshot.format?.id==='30280'&&document.querySelector('audio').readyState>=2&&document.querySelector('audio').currentTime>1);
    const retried=await state();assert.equal(retried.selection.preference,'compatible');assert.equal(retried.preference,'economy');assert(retried.paused);assert.equal(retried.current,before.current);
    await scenario('quality-prepare-hang');await begin('changeAudio',{preference:'auto',formatId:'30232'});await until(snapshot=>snapshot.events.some(event=>event.kind==='playurl'&&event.status===null));await service.rpc('change',{scenario:'healthy'});await begin('play',{ref:{provider:'bilibili',kind:'video',id:'BV1000000001',part:'902'},resourceId:'second',title:'第二段'});await playing();assert.equal((await state()).part,'902');assert.equal((await state()).format,'30216');
    const stable=await state();await scenario('quality-prepare-hang');await begin('changeAudio',{preference:'auto',formatId:'30232'});await until(snapshot=>snapshot.events.some(event=>event.kind==='playurl'&&event.status===null));await invoke('sourceChanged');await service.rpc('change',{scenario:'healthy'});await page.waitForFunction(()=>!window.qualityProbe.preparing);assert.equal((await state()).format,stable.format);
    await invoke('stop');await invoke('setAudioPreference','auto');await scenario('quality-prepare-delay');await begin('playChartItem',synthetic);await until(snapshot=>snapshot.events.some(event=>event.kind==='playurl'&&event.status===null));await invoke('setAudioPreference','economy');await playing();assert.equal((await state()).format,'30280','A pending selection retains its original policy');
    const beforeSleep=await state();
    await scenario('probe-body-hang');
    await begin('changeAudio',{preference:'economy'});
    await until(snapshot=>snapshot.events.some(event=>event.kind==='media'&&event.probe&&event.status===206));
    const releasedOnExpiry=candidateReleased();
    await invoke('startSleep',{trigger:{type:'duration',durationMs:40},action:'pause'});
    const [,appliedAfterExpiry]=await Promise.all([releasedOnExpiry,page.evaluate(()=>window.qualityTask)]);
    assert.equal(appliedAfterExpiry,false);
    await page.waitForFunction(()=>window.qualityProbe.sleep.status==='expired'&&!window.qualityProbe.sleep.actionPending);
    const expired=await state();assert(expired.paused);assert.equal(expired.format,beforeSleep.format);assert.equal(expired.current,beforeSleep.current);
    await scenario('healthy');await invoke('toggle');await playing();
    const running=await state();assert.equal(await invoke('changeAudio',{preference:'economy'}),true);await playing();const resumed=await state();assert.equal(resumed.format,'30216');assert.equal(resumed.current,running.current);assert(resumed.time>=running.time-.15);
    await scenario('quality-prepare-delay');await begin('changeAudio',{preference:'compatible'});await until(snapshot=>snapshot.events.some(event=>event.kind==='playurl'&&event.status===null));await invoke('toggle');await page.waitForFunction(()=>window.qualityProbe.snapshot.format?.id==='30280'&&!window.qualityProbe.preparing&&document.querySelector('audio').readyState>=2);assert((await state()).paused,'A pause during preparation is retained by the selected audio');
    await scenario('quality-prepare-hang');await begin('changeAudio',{preference:'economy'});await until(snapshot=>snapshot.events.some(event=>event.kind==='playurl'&&event.status===null));await invoke('cancel');await service.rpc('change',{scenario:'healthy'});await page.waitForFunction(()=>!window.qualityProbe.preparing);assert.equal((await state()).format,'30280');assert((await state()).paused);
    const beforeClose=await state();await scenario('quality-prepare-hang');
    await page.getByRole('button',{name:'音质与音轨',exact:true}).click();
    await dialog.getByRole('combobox',{name:'本次播放选择'}).selectOption('preference:economy');
    await dialog.getByRole('button',{name:'应用到当前曲'}).click();
    await until(snapshot=>snapshot.events.some(event=>event.kind==='playurl'&&event.status===null));
    if(surface==='desktop')await dialog.getByRole('button',{name:'关闭',exact:true}).click();else await page.keyboard.press('Escape');
    await dialog.waitFor({state:'detached'});await page.waitForFunction(()=>!window.qualityProbe.preparing);
    await until(snapshot=>snapshot.events.some(event=>event.kind==='playurl'&&event.error==='cancelled'));
    const afterClose=await state();assert.equal(afterClose.current,beforeClose.current);assert.equal(afterClose.format,beforeClose.format);assert.deepEqual(afterClose.selection,beforeClose.selection);assert(afterClose.paused);assert(Math.abs(afterClose.time-beforeClose.time)<.15);
    await service.rpc('change',{scenario:'healthy'});
    await page.getByRole('button',{name:'音质与音轨',exact:true}).click();await page.getByRole('dialog',{name:'音质与音轨'}).waitFor();await page.screenshot({path:join(output,surface+'.png'),fullPage:true});if(surface==='mobile'){await page.setViewportSize({width:320,height:640});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await page.getByRole('dialog',{name:'音质与音轨'}).getByRole('combobox',{name:'本次播放选择'}).evaluate(element=>element.getBoundingClientRect().height>=48));}
    if(surface==='desktop'){const previous=await state(),nextList=page.waitForRequest(request=>new URL(request.url()).pathname==='/v1/call/formats'&&request.postDataJSON()?.ref?.part==='902');await invoke('playSelection',{kind:'source',ref:{provider:'bilibili',kind:'video',id:'BV1000000001',part:'902'}},{title:'第二分 P',artists:[]},true);await nextList;assert.equal((await state()).current,previous.current);assert.equal((await state()).part,'902');}
    // A failed replacement must not change the source descriptor used by recovery.
    await scenario('healthy');await invoke('setAudioPreference','compatible');await invoke('playChart',[synthetic]);await playing();await invoke('toggle');const chartBefore=await state();
    assert.equal(await invoke('changeAudio',{preference:'auto',formatId:'missing'}),false);await invoke('setAudioPreference','economy');
    const chartRecovery=page.waitForResponse(response=>new URL(response.url()).pathname==='/v1/call/prepare');
    await page.evaluate(()=>document.querySelector('audio').dispatchEvent(new Event('error')));await chartRecovery;
    await page.waitForFunction(()=>document.querySelector('audio').readyState>=2&&window.qualityProbe.snapshot.format?.id==='30280');
    const chartAfter=await state();assert.equal(chartAfter.format,chartBefore.format);assert.equal(chartAfter.selection.preference,'compatible');assert.equal(chartAfter.current,chartBefore.current);assert.equal(chartAfter.part,chartBefore.part);assert(chartAfter.paused);await invoke('setAudioPreference','economy');
    assert.equal((await state()).elements,1);assert.deepEqual(issues,[]);await invoke('release');await until(snapshot=>snapshot.activeFetches===0&&snapshot.openBodies===0);const reads=(await service.rpc('snapshot')).events.filter(event=>event.kind==='media').length;await page.reload();await page.waitForFunction(()=>!!window.qualityProbe);assert.equal((await state()).preference,'economy');assert.equal((await state()).format,undefined);assert.equal((await service.rpc('snapshot')).events.filter(event=>event.kind==='media').length,reads);report.cases.push({surface,policySelection:true,pausedContinuity:true,playingContinuity:true,pauseDuringPrepare:true,cancelPreservesCurrent:true,preferencePersistence:true,manualPinned:true,failedDeliveryPreservesCurrent:true,sleepExpiryCancelsPendingSwitch:true,switchAfterSleepExpiry:true,permissionRetry:true,cancelLateSelection:true,pendingSnapshot:true,chartRecoveryAfterFailedAudio:true,singleMedia:true,continuityCycles:100,boundedRecords:bounded});
  });
  report.shutdown=await service.close();service=undefined;assert(Object.values(report.shutdown).every(value=>value===0));
});

test('full App exposes audio preferences and the current-track dialog on desktop and mobile',{timeout:60000},async t=>{
  const fixture=await startSongManagementFixture();t.after(fixture.close);const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});t.after(()=>browser.close());
  const outputRoot=process.env.MUSIC_APP_AUDIO_QUALITY_OUTPUT??developmentPaths().artifacts;await mkdir(outputRoot,{recursive:true});const output=await mkdtemp(join(outputRoot,'audio-app-'));
  for(const [surface,width] of [['desktop',1440],['mobile',390]]){
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(10000);let prepares=0;const errors=[];page.on('pageerror',error=>errors.push(error.name));page.on('request',request=>{if(new URL(request.url()).pathname==='/v1/call/prepare')prepares++;});
    await page.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
    await page.route('**/v1/handshake',route=>route.fulfill({json:{protocol:2,capabilities:[{provider:'bilibili',operations:['metadata','prepare','search','formats'],anonymous:true,limitations:[]}]}}));
    await page.route('**/v1/call/formats',route=>route.fulfill({json:{protocol:2,result:[{id:'wav',codec:'1',mimeType:'audio/wav',container:'wav',sampleRate:8000,bitDepth:16,channels:1}]}}));
    await page.goto(fixture.origin);await navigate(page,'收藏');
    const dialog=page.getByRole('dialog',{name:'音质与音轨'});
    if(surface==='desktop'){
      await page.getByRole('button',{name:'更多播放选项',exact:true}).click();
      await page.getByRole('button',{name:'音质与音轨',exact:true}).click();
      assert.equal(await dialog.getByRole('combobox',{name:'默认音质'}).inputValue(),'auto');
      assert.equal(await dialog.getByRole('combobox',{name:'本次播放选择'}).count(),0);
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button',{name:'播放 晴天',exact:true}).click();await page.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>.1;});
    if(surface==='mobile')await page.getByRole('button',{name:'打开正在播放',exact:true}).click();
    await page.getByRole('button',{name:'更多播放选项',exact:true}).click();
    const count=prepares;
    if(surface==='mobile')await page.getByRole('combobox',{name:'默认音质'}).selectOption('compatible');
    await page.getByRole('button',{name:'音质与音轨',exact:true}).click();await dialog.getByRole('option',{name:/8 kHz/}).waitFor({state:'attached'});
    const defaults=dialog.getByRole('combobox',{name:'默认音质'});
    if(surface==='desktop')await defaults.selectOption('compatible');
    assert.equal(await defaults.inputValue(),'compatible');await page.waitForTimeout(100);assert.equal(prepares,count);
    await dialog.getByRole('combobox',{name:'本次播放选择'}).selectOption('format:wav');
    await dialog.getByRole('button',{name:'应用到当前曲'}).click();
    await dialog.getByText('本次指定音轨 · 来源音轨规格',{exact:true}).waitFor();
    await page.screenshot({path:join(output,surface+'.png'),fullPage:true});await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.equal(await page.locator('audio').count(),1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Full App audio controls: '+output);
});
