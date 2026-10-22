import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

test('real server preloads before login, keeps cached batches, and restores the last YouTube region on restart',{timeout:30000},async()=>{
  const root=resolve('.'),directory=mkdtempSync(join(tmpdir(),'music-startup-http-')),moduleUrl=file=>JSON.stringify(pathToFileURL(join(root,'dist/server',file)).href);
  const preload=join(directory,'preload.mjs');
  writeFileSync(preload,`
    import {AccountBilibiliProvider} from ${moduleUrl('bilibili-recommendations.js')};
    import {YoutubeMusicDiscovery} from ${moduleUrl('youtube-discovery.js')};
    import {MusicCharts} from ${moduleUrl('charts.js')};
    const notify=value=>process.send(value);let active=0;
    const delay=async key=>{notify({phase:'start',key,active:++active});await new Promise(resolve=>setTimeout(resolve,20));notify({phase:'end',key,active:--active});};
    const track=(id,provider)=>({ref:{provider,kind:'video',id:provider==='bilibili'?'BV'+String(id).padStart(10,'0'):String(id).padStart(11,'0')},resourceId:provider+':'+id,title:'Music '+id,url:'https://example.com'});
    let batches=0;
    AccountBilibiliProvider.prototype.discoverCandidates=async function(){await delay('bilibili');return [{id:'music-recommendation',title:'B站推荐',kind:'recommendation',page:{items:Array.from({length:20},(_,i)=>track(++batches*100+i,'bilibili'))}}];};
    YoutubeMusicDiscovery.prototype.read=async function(region){await delay('youtube:'+region);return {region,shelf:{id:'youtube-music-selection',title:'YouTube 推荐',kind:'recommendation',page:{items:Array.from({length:20},(_,i)=>track(500+i,'youtube'))}},sourceUrl:'https://example.com',fetchedAt:Date.now(),catalogueUpdatedAt:Date.now(),playlists:[],warnings:[]};};
    MusicCharts.prototype.read=async function(input){const key=input.source+':'+input.chart;await delay(key);return {source:input.source,chart:input.chart,title:key,items:[{rank:1,title:key}],sourceUrl:'https://example.com',fetchedAt:Date.now(),refreshAfter:Date.now()+86400000};};
  `);
  const listener=createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const configFile=join(directory,'config.json');
  writeFileSync(configFile,JSON.stringify({host:'127.0.0.1',port,allowedHosts:['127.0.0.1'],accessKey:'isolated-startup-test',userSpace:'isolated',database:join(directory,'library.sqlite'),runtimeDirectory:directory,mediaLeaseTtlMs:85000,ytDlp:{executable:process.execPath,nodeRuntime:process.execPath}}));
  const base='http://127.0.0.1:'+port;let child,cookie='',events=[],logs='';
  const start=async()=>{
    events=[];logs='';cookie='';child=spawn(process.execPath,['--import',pathToFileURL(preload).href,join(root,'scripts/start.mjs')],{cwd:directory,env:{...process.env,MUSIC_APP_CONFIG:configFile},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);child.on('message',message=>events.push(message));
    const deadline=Date.now()+15000;while(Date.now()<deadline){if(child.exitCode!==null)throw new Error(logs);try{if((await fetch(base)).ok&&events.filter(event=>event.phase==='end').length>=7)return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('startup not ready: '+logs);
  };
  const api=(path,body)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'X-Music-App':'1','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  const stop=async()=>{const state=JSON.parse(readFileSync(join(directory,'service.json'),'utf8')),exited=new Promise(resolve=>child.once('exit',resolve));assert((await fetch(base+'/internal/stop',{method:'POST',headers:{'X-Control-Key':state.key}})).ok);await exited;};
  try{
    await start();assert.equal((await api('/api/status')).status,401);assert.equal((await api('/api/discovery/bilibili')).status,401);
    assert.equal(events.filter(event=>event.phase==='start'&&event.key==='bilibili').length,1);assert.equal(events.filter(event=>event.phase==='end').length,7);assert(events.every(event=>event.active<=3));assert(!events.some(event=>event.key.startsWith('youtube:')));
    const login=await api('/api/login',{accessKey:'isolated-startup-test'});cookie=login.headers.get('set-cookie').split(';')[0];
    const first=(await api('/api/discovery/bilibili').then(response=>response.json()))[0],count=events.length;
    const again=(await api('/api/discovery/bilibili').then(response=>response.json()))[0];assert.equal(again.recommendation.batchId,first.recommendation.batchId);assert.equal(first.page.items.length,12);assert.equal(events.length,count);
    const next=(await api('/api/discovery/bilibili?refresh=1').then(response=>response.json()))[0];assert.notEqual(next.recommendation.batchId,first.recommendation.batchId);
    assert.equal((await api('/api/discovery/bilibili?refresh=bad')).status,400);
    const settings=await api('/api/settings/sources').then(response=>response.json());assert.equal(settings.youtube.enabled,false);assert.equal(settings.youtube.disabledDisplay,'dim');
    assert.equal((await api('/api/youtube/music?region=JP&shared=1')).status,503);
    const enabled=await api('/api/settings/sources',{revision:settings.revision,youtube:{enabled:true,disabledDisplay:'dim'}}).then(response=>response.json());assert.equal(enabled.youtube.enabled,true);
    for(let attempt=0;attempt<100;attempt++){if((await api('/api/settings/sources').then(response=>response.json())).youtube.available)break;await new Promise(done=>setTimeout(done,20));}
    assert.equal((await api('/api/youtube/music?region=JP&shared=1')).status,200);
    const library=await api('/api/song-library').then(response=>response.json());await stop();await start();
    for(let attempt=0;attempt<100&&!events.some(event=>event.key==='youtube:JP');attempt++)await new Promise(done=>setTimeout(done,20));
    assert(events.some(event=>event.key==='youtube:JP'));assert.equal(events.filter(event=>event.phase==='start'&&event.key==='bilibili').length,1);
    const relogin=await api('/api/login',{accessKey:'isolated-startup-test'});cookie=relogin.headers.get('set-cookie').split(';')[0];assert.deepEqual(await api('/api/song-library').then(response=>response.json()),library);await stop();
  }finally{if(child?.exitCode===null)child.kill();}
});
