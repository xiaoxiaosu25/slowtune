import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {developmentPaths} from './workspace-paths.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const count=Number(process.env.MUSIC_APP_LIBRARY_PERF_SONGS??10000);
if(!Number.isInteger(count)||count<100||count>10000)throw Error('Synthetic song count must be 100..10000');
const output=resolve(process.env.MUSIC_APP_LIBRARY_PERF_OUTPUT??join(developmentPaths().testRuntime,'library-playback-performance-'+Date.now()));
const buildRoot=resolve(process.env.MUSIC_APP_TEST_BUILD??root);
const module=name=>import(pathToFileURL(join(buildRoot,'dist/server',name+'.js')));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

if(process.argv.includes('--host')){
  await mkdir(output,{recursive:true});
  const [{SongLibraryStore},{SongLibraryService},{SongLibrarySync},{createSongLibraryRouter}]=await Promise.all(['song-library-store','song-library-service','song-library-sync','song-library-http'].map(module));
  const store=new SongLibraryStore(join(output,'synthetic.sqlite'),'performance'),library=new SongLibraryService(store);
  const bv=i=>'BV'+String(i).padStart(10,'0'),videos=Array.from({length:count},(_,i)=>({bvid:bv(i+1),aid:String(i+1)}));
  store.onSurface(true,()=>library.transaction(null,({document})=>{
    document.syncLinks.push({id:'link',accountId:'123',folderId:'10',targetId:'system:favorites',state:'ready',issues:[],observed:videos.map(v=>v.bvid)});
    for(let i=0;i<count;i++){
      const songId='song-'+i,versionId='version-'+i+'-0',member={kind:'favorite',favoriteId:'favorite-'+i};
      document.snapshot.songs.push({id:songId,title:'合成歌曲 '+i,artists:['测试歌手'],contentKind:'single',fields:{title:{source:'manual',protected:true},artists:{source:'manual',protected:true}},originals:[],aliases:[],defaultVersionId:versionId,organization:'organized',createdAt:1,updatedAt:1});
      for(let part=0;part<2;part++)document.snapshot.versions.push({id:'version-'+i+'-'+part,songId,ref:{provider:'bilibili',kind:'video',id:bv(i+1),part:String(part+1)},label:'',kind:'studio',facts:{title:'合成版本 '+i+'-'+part,durationSeconds:180},availability:{state:'unknown'}});
      document.snapshot.favorites.push({favoriteId:member.favoriteId,songId,position:i,addedAt:1});document.origins.push({member,local:'present'});document.syncMappings.push({linkId:'link',member,bvid:bv(i+1),versionId});
    }
  }));
  let transactions=[],chunkGaps=[],lastChunk=0;
  const transaction=store.transaction.bind(store);
  store.transaction=(...args)=>{const start=performance.now();try{return transaction(...args);}finally{transactions.push(performance.now()-start);}};
  // Remote reads are synthetic; any attempted remote mutation fails the measurement.
  const remote={context:async signal=>({accountId:'123',credential:{revision:'synthetic'},signal}),check:c=>c.signal.throwIfAborted(),folders:async()=>[{id:'10',title:'合成收藏夹',count,private:true}],videos:async()=>videos.map(v=>({...v})),aid:async()=>{throw Error('Unexpected aid lookup');},change:async()=>{throw Error('Remote mutation is outside this measurement');},createFolder:async()=>{throw Error('Remote creation is outside this measurement');}};
  const sync=new SongLibrarySync(library,remote,async()=>{throw Error('Unexpected metadata read');}),router=createSongLibraryRouter(library,()=> 'measurement',undefined,undefined,sync);
  const backup=store.onSurface(true,()=>library.export());
  const histogram=monitorEventLoopDelay({resolution:10});histogram.enable();
  const audio=Buffer.alloc(44+32000*120);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
  for(let i=44;i<audio.length;i+=2)audio.writeInt16LE(Math.round(1000*Math.sin(i/20)),i);
  const streams=new Set();
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
    try{
      if(url.pathname==='/') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><audio src="/media.wav" preload="none"></audio>');return;}
      if(url.pathname==='/ping'){json({ok:true});return;}
      if(url.pathname==='/measure/start'){histogram.reset();transactions=[];chunkGaps=[];lastChunk=0;json({ok:true});return;}
      if(url.pathname==='/measure/end'){json({eventLoop:{p95Ms:histogram.percentile(95)/1e6,p99Ms:histogram.percentile(99)/1e6,maxMs:histogram.max/1e6},transactionMs:transactions,mediaChunkMaxGapMs:Math.max(0,...chunkGaps)});return;}
      if(url.pathname==='/media.wav'){
        const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??''),start=Number(range?.[1]??0),end=range?.[2]?Math.min(Number(range[2]),audio.length-1):audio.length-1;
        res.writeHead(range?206:200,{'Content-Type':'audio/wav','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${audio.length}`}:{})});
        let at=start;const timer=setInterval(()=>{const now=performance.now();if(lastChunk)chunkGaps.push(now-lastChunk);lastChunk=now;const next=Math.min(at+3200,end+1);res.write(audio.subarray(at,next));at=next;if(at>end){clearInterval(timer);res.end();}},100);streams.add(timer);res.on('close',()=>{clearInterval(timer);streams.delete(timer);});return;
      }
      if(url.pathname==='/backup-input'){json({revision:store.revision(),backup});return;}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
      const headers=new Headers(req.headers);headers.set('X-SlowTune-Surface','desktop');
      const response=await router.fetch(new Request('http://'+req.headers.host+url.pathname+url.search,{method:req.method,headers,signal:controller.signal,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:error.code??'measurement-failed'}}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));process.send({port:server.address().port,backupBytes:Buffer.byteLength(backup)});
  process.on('message',async message=>{if(message!=='stop')return;histogram.disable();for(const timer of streams)clearInterval(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await sync.dispose();await store.close();process.disconnect();});
}else{
  await mkdir(output,{recursive:true});
  const child=fork(fileURLToPath(import.meta.url),['--host'],{cwd:root,env:{...process.env,MUSIC_APP_LIBRARY_PERF_OUTPUT:output},stdio:['ignore','inherit','inherit','ipc'],windowsHide:true});
  let browser;
  try{
    const ready=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('Measurement host exited '+code)));});
    const {chromium}=await import('../tests/helpers/browser.mjs');browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
    const page=await browser.newPage();await page.goto('http://127.0.0.1:'+ready.port);
    await page.evaluate(async()=>{const audio=document.querySelector('audio');window.mediaEvents=[];for(const type of ['waiting','stalled','error','ended'])audio.addEventListener(type,()=>window.mediaEvents.push({type,at:performance.now(),position:audio.currentTime}));await audio.play();});
    await page.waitForFunction(()=>document.querySelector('audio').currentTime>.2);
    const input=await page.evaluate(()=>fetch('/backup-input').then(r=>r.json()));
    const cases=[['idle',null],['export',{path:'/export'}],['sync-state',{path:'/sync'}],['sync-preview',{path:'/sync/preview',body:{revision:input.revision,link:{folderId:'10',targetId:'system:favorites',linkId:'link'}}}],['sync-run',{path:'/sync/control',body:{revision:input.revision,control:{action:'run',linkId:'link'}}}],['import-preview',{path:'/imports/preview?mode=append',raw:input.backup}]];
    const reports=[];
    for(const [name,operation]of cases){
      // Each case starts from the current revision; the previous sync may have committed.
      const revision=await page.evaluate(()=>fetch('/events').then(r=>r.json()).then(r=>r.revision));if(operation?.body)operation.body.revision=revision;
      const result=await page.evaluate(async({operation,revision})=>{
        await fetch('/measure/start');const audio=document.querySelector('audio'),before=audio.currentTime,eventsBefore=window.mediaEvents.length,pings=[];let pending=[];
        const ping=()=>{const start=performance.now();const task=fetch('/ping').then(r=>r.json()).then(()=>pings.push(performance.now()-start));pending.push(task);};
        const timer=setInterval(ping,40);let status=200,bytes=0,durationMs;
        try{await new Promise(r=>setTimeout(r,160));const start=performance.now();
          if(operation){const response=await fetch(operation.path,{method:operation.body||operation.raw?'POST':'GET',headers:{'Content-Type':'application/json','X-Music-App':'1','X-SlowTune-Surface':'desktop','X-SlowTune-Revision':revision??'null'},...(operation.raw?{body:operation.raw}:operation.body?{body:JSON.stringify(operation.body)}:{})});status=response.status;bytes=(await response.arrayBuffer()).byteLength;}
          else await new Promise(r=>setTimeout(r,500));durationMs=performance.now()-start;await new Promise(r=>setTimeout(r,240));
        }finally{clearInterval(timer);await Promise.all(pending);}
        pings.sort((a,b)=>a-b);return {status,bytes,durationMs,requestLatency:{samples:pings.length,p95Ms:pings[Math.ceil(pings.length*.95)-1],maxMs:Math.max(0,...pings)},playback:{before,after:audio.currentTime,paused:audio.paused,mediaError:audio.error?.code??null,events:window.mediaEvents.slice(eventsBefore)},server:await fetch('/measure/end').then(r=>r.json())};
      },{operation,revision});
      reports.push({name,...result});await writeFile(join(output,'report.partial.json'),JSON.stringify({songs:count,versions:count*2,reports},null,2));assert.equal(result.status,200,name);assert.equal(result.playback.mediaError,null,name);console.log(JSON.stringify({name,durationMs:result.durationMs,maxRequestMs:result.requestLatency.maxMs,eventLoopMaxMs:result.server.eventLoop.maxMs}));
    }
    const report={node:process.version,platform:process.platform,songs:count,versions:count*2,favorites:count,backupBytes:ready.backupBytes,reports,scope:'Synthetic file SQLite and read-only remote fixture; streamed PCM in Edge. Transaction duration includes computation and persistence, not a separate measurement of lock waiting. No daily data, accounts, device sleep, speakers or real remote writes.'};
    await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log('Report: '+join(output,'report.json'));
  }finally{await browser?.close();if(child.connected)child.send('stop');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(10000).then(()=>{if(child.exitCode===null)child.kill();})]);}
}
