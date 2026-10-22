import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {AccountBilibiliProvider} from '../dist/server/bilibili-recommendations.js';
import {BrowseCache} from '../dist/server/browse-cache.js';
import {RecommendationStore} from '../dist/server/recommendation.js';

const root=fileURLToPath(new URL('..',import.meta.url)),buildRoot=resolve(process.env.MUSIC_APP_TEST_BUILD??root);
const rejectedId='BV1bjTG6vEW4',songId='BV0000000001';
const rejected={bvid:rejectedId,title:'只打不飞，会发生什么？',tid:31,tname:'',tid_v2:2181,tname_v2:'',duration:131,pages:[{cid:1000,duration:131}]};
const song={bvid:songId,title:'测试音乐',tid:31,tid_v2:2020,pages:[{cid:1001,duration:240}]};
const oldSongs=Array.from({length:12},(_,i)=>({...song,bvid:'BV'+String(100+i).padStart(10,'0'),title:'旧推荐 '+i}));
const freshSongs=Array.from({length:8},(_,i)=>({...song,bvid:'BV'+String(200+i).padStart(10,'0'),title:'新推荐 '+i}));
const excludedSong={...song,bvid:'BV0000000300',title:'排除歌曲'};
const response=data=>Response.json({code:0,data});

test('desktop account recommendations use current partitions while the mobile policy stays frozen',async t=>{
  const cases=[
    {name:'reported health video',data:rejected,desktop:false,legacy:true},
    {name:'nonmusic current ID beats both music names and legacy ID',data:{tid:31,tid_v2:2181,tname:'翻唱',tname_v2:'音乐相关'},desktop:false,legacy:true},
    {name:'current ID alias',data:{tid:31,tidv2:2181},desktop:false,legacy:true},
    {name:'current music beats old nonmusic ID',data:{tid:17,tid_v2:2020},desktop:true,legacy:true},
    {name:'current music beats stale commentary metadata',data:{tid:243,tname:'乐评盘点',tid_v2:2020},desktop:true,legacy:false},
    {name:'current music beats stale teaching metadata',data:{tid:244,tname:'音乐教学',tid_v2:2021},desktop:true,legacy:false},
    {name:'music teaching remains excluded',data:{tid:31,tid_v2:2025},desktop:false,legacy:false},
    {name:'music commentary remains excluded',data:{tid:31,tid_v2:2026},desktop:false,legacy:false},
    {name:'unrecognized positive current ID cannot fall back',data:{tid:31,tid_v2:9999,tname:'翻唱'},desktop:false,legacy:true},
    {name:'legacy music without current ID',data:{tid:31},desktop:true,legacy:true},
    {name:'current music ID supplied in legacy field',data:{tid:2021},desktop:true,legacy:true},
    {name:'nonmusic legacy ID beats music name',data:{tid:17,tname:'音乐'},desktop:false,legacy:true},
    {name:'missing numeric IDs use category name',data:{tname_v2:'翻唱'},desktop:true,legacy:true},
    {name:'name fallback still excludes teaching',data:{tname_v2:'音乐教学'},desktop:false,legacy:false},
    {name:'name fallback still excludes commentary',data:{tname:'音乐乐评盘点'},desktop:false,legacy:false},
    {name:'zero current ID falls back to legacy',data:{tid:31,tid_v2:0},desktop:true,legacy:true},
    {name:'invalid current ID falls back to legacy',data:{tid:31,tid_v2:'invalid'},desktop:true,legacy:true},
    {name:'numeric string current ID',data:{tid:17,tid_v2:'2020'},desktop:true,legacy:true},
    {name:'current teaching name remains excluded',data:{tid:31,tid_v2:2020,tname_v2:'音乐教学'},desktop:false,legacy:false},
    {name:'legacy teaching cannot use name fallback',data:{tid:244,tname:'翻唱'},desktop:false,legacy:false},
    {name:'MV name fallback',data:{tname:'MV'},desktop:true,legacy:true},
    {name:'music title alone never admits unknown partition',data:{title:'音乐单曲'},desktop:false,legacy:false},
  ];
  for(const [index,item] of cases.entries())await t.test(item.name,async()=>{
    const video={bvid:'BV'+String(index+10).padStart(10,'0'),title:'视频',pages:[{cid:index+2000,duration:240}],...item.data};
    const provider=new AccountBilibiliProvider();
    const host={now:Date.now,md5:value=>createHash('md5').update(value).digest('hex'),fetch:async input=>{
      const url=new URL(input);
      if(url.pathname.endsWith('/nav'))return response({isLogin:true,wbi_img:{img_url:'https://i0.hdslb.com/'+ 'a'.repeat(32)+'.png',sub_url:'https://i0.hdslb.com/'+ 'b'.repeat(32)+'.png'}});
      if(url.pathname.endsWith('/index/top/feed/rcmd'))return response({item:[{goto:'av',id:index+10,bvid:video.bvid,title:video.title}]});
      if(url.pathname.endsWith('/view'))return response(video);
      throw new Error('Unexpected endpoint '+url.pathname);
    }};
    try{
      for(const desktop of [true,false]){
        const shelves=await provider.discoverCandidates({host,scope:desktop?'desktop':'mobile',signal:AbortSignal.timeout(5000),credential:{cookie:'fixture-only'}},[],()=>false,desktop);
        assert.equal(shelves[0].page.items.some(entry=>entry.ref.id===video.bvid),desktop?item.desktop:item.legacy,desktop?'desktop result':'unchanged mobile result');
      }
    }finally{await provider.dispose();}
  });
});

test('HTTP desktop recommendation batches reject old policy caches and keep mobile snapshots separate',{timeout:30000},async()=>{
  const parent=join(root,'local/recommendation-partition-fix-20261018');mkdirSync(parent,{recursive:true});
  const directory=mkdtempSync(join(parent,'http-')),preload=join(directory,'preload.mjs');
  const moduleUrl=file=>JSON.stringify(pathToFileURL(join(buildRoot,'dist/server',file)).href);
  writeFileSync(preload,`
    import {BilibiliCredentials} from ${moduleUrl('bilibili-credentials.js')};
    import {AccountBilibiliProvider} from ${moduleUrl('bilibili-recommendations.js')};
    import {MusicCharts} from ${moduleUrl('charts.js')};
    BilibiliCredentials.prototype.open=async function(){this.value={provider:'bilibili',revision:'fixture-account',cookie:'fixture-only'};return this;};
    const videos=${JSON.stringify([rejected,song,excludedSong,...oldSongs,...freshSongs])};
    AccountBilibiliProvider.prototype.json=async function(path,params){
      if(process.env.MUSIC_APP_PARTITION_TEST_OFFLINE==='1')throw new Error('offline');
      const feed=process.env.MUSIC_APP_PARTITION_TEST_FEED;
      const selected=feed==='sparse'?videos.slice(-8):feed==='empty'?[]:videos.slice(0,2);
      if(path.endsWith('/index/top/feed/rcmd'))return {item:selected.map((video,index)=>({goto:'av',id:index+1,bvid:video.bvid,title:video.title}))};
      if(path.endsWith('/view'))return videos.find(video=>video.bvid===params.bvid);
      throw new Error('Unexpected endpoint '+path);
    };
    MusicCharts.prototype.read=async function(){return {items:[]};};
  `);
  const listener=createServer();await new Promise(done=>listener.listen(0,'127.0.0.1',done));const port=listener.address().port;await new Promise(done=>listener.close(done));
  const configFile=join(directory,'config.json'),database=join(directory,'library.sqlite'),base='http://127.0.0.1:'+port;
  let child,logs='',cookie='';
  const request=(path,body)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Music-App':'1'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  const start=async(db=database,offline=false,feed='original')=>{
    writeFileSync(configFile,JSON.stringify({host:'127.0.0.1',port,allowedHosts:['127.0.0.1'],accessKey:'isolated-partition-test',userSpace:'isolated',database:db,runtimeDirectory:directory,mediaLeaseTtlMs:85000}));
    cookie='';logs='';child=spawn(process.execPath,['--import',pathToFileURL(preload).href,join(buildRoot,'dist/server/index.js')],{cwd:directory,env:{...process.env,MUSIC_APP_CONFIG:configFile,MUSIC_APP_PARTITION_TEST_OFFLINE:offline?'1':'0',MUSIC_APP_PARTITION_TEST_FEED:feed},windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',value=>logs+=value);child.stderr.on('data',value=>logs+=value);
    let ready=false;
    for(let attempt=0;attempt<100;attempt++){
      if(child.exitCode!==null)throw new Error(logs);
      try{if((await fetch(base+'/api/bootstrap')).ok){ready=true;break;}}catch{}
      await new Promise(done=>setTimeout(done,30));
    }
    assert(ready,logs);
    assert.equal((await request('/api/discovery/bilibili?surface=desktop')).status,401);
    const login=await request('/api/login',{accessKey:'isolated-partition-test'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  };
  const stop=async()=>{
    const state=JSON.parse(readFileSync(join(directory,'service.json'),'utf8')),exited=new Promise(done=>child.once('exit',done));
    assert((await fetch(base+'/internal/stop',{method:'POST',headers:{'X-Control-Key':state.key}})).ok);await exited;
  };
  const read=async path=>{const result=await request(path);assert.equal(result.status,200,await result.clone().text());return (await result.json())[0];};
  const ids=shelf=>shelf.page.items.map(item=>item.ref.id);
  try{
    await start();
    const mobile=await read('/api/discovery/bilibili');assert(ids(mobile).includes(rejectedId));
    const desktop=await read('/api/discovery/bilibili?surface=desktop');assert.deepEqual(ids(desktop),[songId]);assert.equal(desktop.id,'account-recommendation');
    assert.equal((await read('/api/discovery/bilibili?surface=desktop')).recommendation.batchId,desktop.recommendation.batchId);
    const confirmed=await request('/api/recommendation/confirm',{column:desktop.id,token:desktop.recommendation.token,ids:desktop.page.items.map(item=>JSON.stringify([item.ref.provider,item.ref.id,null]))});assert.equal((await confirmed.json()).accepted,true);
    const preview=await request('/api/recommendation/preview',{column:desktop.id,overrides:{}});assert.deepEqual(ids(await preview.json()),[songId]);
    const next=await read('/api/discovery/bilibili?surface=desktop&refresh=1');assert.deepEqual(ids(next),[songId]);assert.notEqual(next.recommendation.batchId,desktop.recommendation.batchId);
    assert.deepEqual(ids(await read('/api/discovery/bilibili')),ids(mobile));
    assert.equal((await request('/api/discovery/bilibili?surface=invalid')).status,400);
    await stop();

    const cache=new BrowseCache(database+'.browse-cache.sqlite','isolated');
    const saved=cache.entries('recommendation');cache.close();
    const [desktopKey,desktopSnapshot]=saved.find(([key])=>JSON.parse(key)[0]==='bilibili:desktop');
    const signature=JSON.parse(JSON.parse(desktopKey)[1]);assert.equal(signature.at(-1),'music-partitions-v2-first-1');
    assert.deepEqual(ids(desktopSnapshot.selected),[songId]);

    // A failed refresh may retain a compatible filtered snapshot after restart.
    await start(database,true);const retained=await read('/api/discovery/bilibili?surface=desktop&refresh=1');assert.deepEqual(ids(retained),[songId]);assert.equal(retained.recommendation.batchId,next.recommendation.batchId);assert.equal(retained.recommendation.retained,true);await stop();

    // Seed only legacy and outdated-policy snapshots, both containing the reported video.
    const oldDatabase=join(directory,'old-policy.sqlite'),oldCache=new BrowseCache(oldDatabase+'.browse-cache.sqlite','isolated');
    const [mobileKey,mobileSnapshot]=saved.find(([key])=>JSON.parse(key)[0]==='bilibili');oldCache.write('recommendation',mobileKey,mobileSnapshot);
    signature[signature.length-1]='music-partitions-v2-first-0';const oldSignature=JSON.stringify(signature);
    oldCache.write('recommendation',JSON.stringify(['bilibili:desktop',oldSignature]),{...mobileSnapshot,signature:oldSignature});oldCache.close();
    await start(oldDatabase,true);
    assert(ids(await read('/api/discovery/bilibili')).includes(rejectedId),'mobile retains its original compatible snapshot');
    assert.equal((await request('/api/discovery/bilibili?surface=desktop')).status,503,'desktop must not reuse legacy or outdated-policy results when offline');
    await stop();

    // A policy change must revalidate and reuse old candidates instead of leaving four blank rows.
    const migrationDatabase=join(directory,'refill.sqlite'),migrationCache=new BrowseCache(migrationDatabase+'.browse-cache.sqlite','isolated');
    const entries=videos=>videos.map(video=>({ref:{provider:'bilibili',kind:'video',id:video.bvid},resourceId:'bilibili:'+video.bvid,title:video.title,url:'https://www.bilibili.com/video/'+video.bvid}));
    const legacyItems=entries([rejected,excludedSong,...oldSongs]);
    const legacySnapshot={...mobileSnapshot,shelf:{...mobileSnapshot.shelf,page:{items:legacyItems}}};
    migrationCache.write('recommendation',mobileKey,legacySnapshot);
    const foreignSignature=JSON.stringify(['bilibili','another-account',0]);
    migrationCache.write('recommendation',JSON.stringify(['bilibili',foreignSignature]),{...legacySnapshot,signature:foreignSignature,shelf:{...legacySnapshot.shelf,page:{items:entries([song])}}});
    migrationCache.close();
    const settings=new RecommendationStore(migrationDatabase+'.recommendation.sqlite','isolated');
    settings.update('account-recommendation',settings.read('account-recommendation'),{overrides:{exclude:[{id:'excluded',fields:['title'],mode:'any',terms:['排除歌曲']}]}},new AbortController().signal);settings.close();
    await start(migrationDatabase,false,'sparse');
    const filled=await read('/api/discovery/bilibili?surface=desktop');
    assert.equal(filled.page.items.length,12,'eight new songs must be filled with four verified old songs');
    assert.equal(new Set(ids(filled)).size,12);
    assert.deepEqual(ids(filled).slice(0,8),freshSongs.map(video=>video.bvid));
    assert(!ids(filled).includes(rejectedId),'old nonmusic candidates must still be rejected');
    assert(!ids(filled).includes(excludedSong.bvid),'old songs must satisfy the current preferences after a settings change');
    assert(!ids(filled).includes(songId),'another account cannot provide fallback songs');
    await stop();
    await start(migrationDatabase,false,'empty');
    const noNew=await read('/api/discovery/bilibili?surface=desktop&refresh=1');
    assert.equal(noNew.page.items.length,12,'no new songs still retains twelve old qualified songs');
    assert.equal(new Set(ids(noNew)).size,12);assert(!ids(noNew).includes(rejectedId));
    await stop();
  }finally{if(child?.exitCode===null)child.kill();}
});
