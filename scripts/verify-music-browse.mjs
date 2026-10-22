import { resolveConfigFile } from './instance-path.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const sourceRoot=fileURLToPath(new URL('..',import.meta.url)),buildRoot=resolve(process.env.MUSIC_APP_TEST_BUILD??sourceRoot);
const directory=resolve(sourceRoot,'local/verification/chart-playback-2026-10-13/real-service');mkdirSync(directory,{recursive:true});
const originalFile=resolveConfigFile(sourceRoot),original=JSON.parse(readFileSync(originalFile,'utf8'));
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const configFile=join(directory,'config.json'),accessKey='isolated-music-browse-verification';
const ytDlp=original.ytDlp?{...original.ytDlp,executable:resolve(dirname(originalFile),original.ytDlp.executable),nodeRuntime:resolve(dirname(originalFile),original.ytDlp.nodeRuntime)}:undefined;
writeFileSync(configFile,JSON.stringify({host:'127.0.0.1',port,allowedHosts:['127.0.0.1'],accessKey,userSpace:'isolated-music-browse',database:join(directory,'library.sqlite'),runtimeDirectory:join(directory,'runtime'),mediaLeaseTtlMs:85000,...(ytDlp?{ytDlp}:{})}));
const child=spawn(process.execPath,[join(buildRoot,'dist/server/index.js')],{cwd:buildRoot,env:{...process.env,MUSIC_APP_CONFIG:configFile},windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='',browser;child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);const base='http://127.0.0.1:'+port,report={charts:[],playback:{},errors:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
  let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('isolated service failed to start');try{if((await fetch(base)).ok){ready=true;break;}}catch{}await wait(100);}assert(ready);
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));
  assert.equal((await page.request.post(base+'/api/login',{headers:{'X-Music-App':'1'},data:{accessKey}})).status(),200);await page.goto(base);await page.locator('.app').waitFor();
  await page.locator('.sidebar-nav').getByRole('button',{name:'音乐榜单',exact:true}).click();await page.locator('.chart-song').first().waitFor();
  for(const [source,chart] of [['netease','hot'],['netease','new'],['netease','rising'],['qq','hot'],['bilibili','hot'],['apple','most-played']]){
    let response,data;
    for(let attempt=0;attempt<3;attempt++){response=await page.request.get(base+'/api/charts?'+new URLSearchParams({source,chart}));data=await response.json();if(response.status()===200)break;console.log(JSON.stringify({chartRetry:source,attempt:attempt+1,status:response.status(),error:data.error?.code}));if(!['network','upstream','timeout'].includes(data.error?.code))break;await wait(500);}
    assert.equal(response.status(),200,source+' chart '+JSON.stringify(data.error));assert(data.items.length>0);assert(data.items.every(x=>typeof x.title==='string'&&Number.isSafeInteger(x.rank)));assert(data.items.some(x=>x.artists?.length&&x.artwork?.startsWith('https://')));report.charts.push({source,chart,count:data.items.length,artists:data.items.filter(x=>x.artists?.length).length,artworks:data.items.filter(x=>x.artwork).length,period:data.period});
  }
  await page.screenshot({path:join(directory,'live-charts-desktop.png')});
  const title=await page.locator('.chart-song-title').first().textContent();await page.locator('.chart-song-play').first().click();await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>2,{},{timeout:45000});assert.equal(await page.getByRole('dialog',{name:'搜索音乐',exact:true}).count(),0);report.playback.direct=await page.evaluate(()=>({title:document.querySelector('.now-playing strong')?.textContent,playing:!document.querySelector('audio').paused,queue:JSON.parse(localStorage.getItem('slow-listening:playback:v2')).tracks.length}));assert.equal(report.playback.direct.queue,1);
  await page.locator('.chart-play-all').click();await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>2,{},{timeout:45000});report.playback.all=await page.evaluate(()=>{const q=JSON.parse(localStorage.getItem('slow-listening:playback:v2'));return {count:q.tracks.length,pending:q.tracks.filter(x=>x.kind==='chart').length,order:q.order,repeat:q.repeat};});assert.equal(report.playback.all.count,200);assert.equal(report.playback.all.pending,199);assert.equal(report.playback.all.order,'sequential');assert.equal(report.playback.all.repeat,'off');
  await page.locator('.chart-song-search').first().click();const search=page.getByRole('dialog',{name:'搜索音乐',exact:true});assert.equal(await search.getByLabel('弹窗搜索关键词').inputValue(),title);
  const bili=search.locator('.catalog').filter({has:page.getByRole('heading',{name:'B站',exact:true})});await bili.locator('.track-row').first().waitFor();report.playback.searchTitle=title;report.playback.bilibiliResults=await bili.locator('.track-row').count();
  await bili.locator('.row-cover').first().click();
  await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>2,{},{timeout:45000}).catch(async error=>{
    const parts=page.getByRole('dialog',{name:'视频与分 P',exact:true});if(!await parts.count())throw error;await parts.locator('.row-cover').first().click();await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>2,{},{timeout:45000});
  });
  report.playback.bilibili=await page.evaluate(()=>({playing:!document.querySelector('audio').paused,position:document.querySelector('audio').currentTime}));assert(report.playback.bilibili.playing);
  const parts=page.getByRole('dialog',{name:'视频与分 P',exact:true});if(await parts.count())await parts.getByRole('button',{name:'关闭',exact:true}).click();
  await page.screenshot({path:join(directory,'live-search-desktop.png')});await search.getByRole('button',{name:'关闭',exact:true}).click();assert.equal(await page.evaluate(()=>document.querySelector('audio').paused),false);
  await page.setViewportSize({width:390,height:844});await page.locator('.chart-song-search').first().click();await search.locator('.track-row').first().waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(directory,'live-search-phone.png')});await search.getByRole('button',{name:'关闭',exact:true}).click();await page.screenshot({path:join(directory,'live-chart-phone.png')});
  await page.locator('nav:visible').getByRole('button',{name:'歌单',exact:true}).click();assert.equal(await page.locator('.playlist-copy h2').textContent(),'我的收藏');assert.equal(await page.getByRole('button',{name:'删除歌单',exact:true}).count(),0);await page.screenshot({path:join(directory,'live-favorites-phone.png')});
  report.status=(await page.request.get(base+'/api/status').then(r=>r.json())).version;assert.equal(report.status,'0.1.16');assert.deepEqual(report.errors,[]);
  console.log(JSON.stringify(report));
}catch(error){report.failure=error.message;console.error(error.message);process.exitCode=1;}
finally{
  writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2));writeFileSync(join(directory,'service.log'),logs);
  if(browser)await browser.close();
  const stateFile=join(directory,'runtime/service.json');if(child.exitCode===null&&existsSync(stateFile)){const state=JSON.parse(readFileSync(stateFile,'utf8'));const stopped=new Promise(r=>child.once('exit',r));await fetch(base+'/internal/stop',{method:'POST',headers:{'X-Control-Key':state.key}}).catch(()=>{});await Promise.race([stopped,wait(15000)]);}
  if(child.exitCode===null)child.kill();
}
