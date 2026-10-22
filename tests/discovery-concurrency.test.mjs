import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const buildRoot=resolve(process.env.MUSIC_APP_TEST_BUILD ?? root);

test('recommendation refresh and chart selection retain independent HTTP request state', {timeout:20000}, async t=>{
  const parent=join(root,'test-results/discovery-concurrency');mkdirSync(parent,{recursive:true});
  const output=mkdtempSync(join(parent,'run-')),preload=join(output,'preload.mjs');
  const moduleUrl=file=>JSON.stringify(pathToFileURL(join(buildRoot,'dist/server',file)).href);
  // Only the upstream reads are replaced. Both HTTP routes use the real recommendation state.
  writeFileSync(preload,`
    import {AccountBilibiliProvider} from ${moduleUrl('bilibili-recommendations.js')};
    import {MusicCharts} from ${moduleUrl('charts.js')};
    const track=id=>({ref:{provider:'bilibili',kind:'video',id:'BV'+String(id).padStart(10,'0')},resourceId:'chart-'+id,title:'期次 '+id,url:'https://www.bilibili.com/video/BV'+String(id).padStart(10,'0')});
    const shelf=(id,kind,number)=>({id,title:id,kind,page:{items:[track(number)]}});
    const gate=phase=>new Promise(resolve=>{const resume=message=>{if(message===phase){process.off('message',resume);resolve();}};process.on('message',resume);process.send({phase});});
    let discoveries=0;
    AccountBilibiliProvider.prototype.discoverCandidates=async function(){
      if(++discoveries===2)await gate('discovery');
      return [shelf('music-recommendation','recommendation',discoveries)];
    };
    MusicCharts.prototype.read=async function(input,signal){const period=input.period&&input.period!=='latest'?Number(input.period):439;
      if(period===437)await gate('chart');
      signal.throwIfAborted();
      const periods=[439,437,435].map(id=>({id,number:id,publishedAt:1}));
      return {source:'bilibili',chart:'hot',title:'B站热歌榜',items:[{rank:1,title:'期次 '+period}],periods,period:periods.find(p=>p.id===period),sourceUrl:'https://music.bilibili.com',fetchedAt:1};
    };
  `);
  const listener=createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const configFile=join(output,'config.json');
  writeFileSync(configFile,JSON.stringify({host:'127.0.0.1',port,allowedHosts:['127.0.0.1'],accessKey:'isolated-test-access',userSpace:'isolated',database:join(output,'library.sqlite'),runtimeDirectory:output,mediaLeaseTtlMs:85000}));
  const child=spawn(process.execPath,['--import',pathToFileURL(preload).href,join(buildRoot,'dist/server/index.js')],{cwd:output,env:{...process.env,MUSIC_APP_CONFIG:configFile},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  let logs='',cookie='';const phases=new Set(),waiters=new Map();
  child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
  child.on('message',({phase})=>{phases.add(phase);waiters.get(phase)?.();});
  const waitFor=phase=>new Promise(resolve=>{if(phases.has(phase))resolve();else waiters.set(phase,resolve);});
  const base='http://127.0.0.1:'+port;
  const request=(path,body)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Music-App':'1'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  const confirm=async value=>{
    const result=await request('/api/recommendation/confirm',{column:value.id,token:value.recommendation.token,ids:value.page.items.map(item=>JSON.stringify([item.ref.provider,item.ref.id,null]))});
    assert.equal(result.status,200);assert.equal((await result.json()).accepted,true);
  };
  try {
    let ready=false;
    for(let attempt=0;attempt<100;attempt++){
      if(child.exitCode!==null)throw new Error(logs);
      try{if((await fetch(base)).ok){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert(ready,logs);
    const login=await request('/api/login',{accessKey:'isolated-test-access'});assert.equal(login.status,200);
    cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/discovery/bilibili')).status,200);
    assert.equal((await request('/api/charts?source=bilibili&period=latest')).status,200);

    await t.test('switching periods during a recommendation refresh preserves both responses and the chart preview',async()=>{
      const refreshing=request('/api/discovery/bilibili?refresh=1');await waitFor('discovery');
      const switched=await request('/api/charts?source=bilibili&period=435');assert.equal(switched.status,200);
      const chart=await switched.json();child.send('discovery');
      const refreshed=await refreshing;assert.equal(refreshed.status,200);
      const shelves=await refreshed.json();assert.equal(shelves.length,1);
      assert.equal(chart.items[0].title,'期次 435');await confirm(shelves.find(shelf=>shelf.kind==='recommendation'));
      const preview=await request('/api/recommendation/preview',{column:'music-recommendation',overrides:{}});
      assert.equal(preview.status,200);assert.equal((await preview.json()).page.items[0].title,'期次 2','chart reads must not affect recommendation candidates');
    });

    await t.test('a recommendation refresh cannot invalidate an already pending chart selection',async()=>{
      const selecting=request('/api/charts?source=bilibili&period=437');await waitFor('chart');
      const refreshed=await request('/api/discovery/bilibili?refresh=1');assert.equal(refreshed.status,200);
      child.send('chart');const selected=await selecting;assert.equal(selected.status,200);
      const chart=await selected.json();assert.equal(chart.period.id,437);assert.deepEqual(Object.keys(chart.items[0]),['rank','title']);
    });

    const state=JSON.parse(readFileSync(join(output,'service.json'),'utf8'));
    const exited=new Promise(resolve=>child.once('exit',resolve));
    assert((await fetch(base+'/internal/stop',{method:'POST',headers:{'X-Control-Key':state.key}})).ok);
    child.disconnect();await exited;
  } finally {if(child.exitCode===null)child.kill();}
});
