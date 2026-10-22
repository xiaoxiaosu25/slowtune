import { resolveConfigFile, workspaceRoot } from './instance-path.mjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { openSettingsPage, closeSettingsPage } from './browser-ui.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),config=JSON.parse(readFileSync(resolveConfigFile(root),'utf8'));
const ip=config.allowedHosts.find(h=>h.startsWith('192.168.'));if(!ip)throw new Error('配置缺少已允许的局域网 IP。');
const base=`http://${ip}:${config.port}`,output=resolve(workspaceRoot,'local/artifacts/music-app','lan-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(output,{recursive:true});
let browser,page,cookie='',environment;const records=[],browserErrors=[];
async function api(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Music-App':'1',Cookie:cookie},...(body!==undefined?{body:JSON.stringify(body)}:{})});assert(r.ok,`${path}: ${r.status}`);return r.json();}
try{
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.on('pageerror',e=>browserErrors.push(e.message));await page.goto(base);
 environment=await page.evaluate(()=>({origin:location.origin,secure:isSecureContext,randomUUID:typeof crypto.randomUUID,getRandomValues:typeof crypto.getRandomValues,userAgent:navigator.userAgent}));assert.equal(environment.secure,false);assert.equal(environment.randomUUID,'undefined');
 await page.getByLabel('服务访问码').fill(config.accessKey);await page.getByRole('button',{name:'进入音乐空间'}).click();await page.getByRole('heading',{name:'发现音乐',exact:true}).waitFor();cookie=(await page.context().cookies()).filter(c=>c.name==='music_session').map(c=>`${c.name}=${c.value}`).join(';');
 for(const ref of [{provider:'bilibili',kind:'video',id:'BV1NPtC6qEeA'},{provider:'youtube',kind:'video',id:'kK0CRZ0wvvc'}]){
  const result=await api('/v1/call/metadata',{protocol:2,ref});assert(!result.error,JSON.stringify(result.error));const entry=result.result;
  await page.locator('.source-tabs').getByRole('button',{name:ref.provider==='bilibili'?'B站':'YouTube 视频',exact:true}).click();await page.getByLabel('搜索歌曲或视频').fill(entry.title);await page.getByRole('button',{name:'开始搜索'}).click();const row=page.locator('.track-row').filter({has:page.getByRole('button',{name:entry.title,exact:true})}).first();await row.waitFor({timeout:60000});await row.getByRole('button',{name:'播放 '+entry.title,exact:true}).click();
  await page.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>.8||[...document.querySelectorAll('.feedback')].some(e=>e.textContent.includes('重试播放'));},undefined,{timeout:70000});
  const media=await page.evaluate(async()=>{const a=document.querySelector('audio');let rms=0;if(a&&!a.paused){if(!window.__lanAudio){const context=new AudioContext(),source=context.createMediaElementSource(a),analyser=context.createAnalyser();source.connect(analyser);analyser.connect(context.destination);window.__lanAudio={context,analyser};}const {context,analyser}=window.__lanAudio;await context.resume();await new Promise(r=>setTimeout(r,300));const arr=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(arr);rms=Math.sqrt(arr.reduce((n,x)=>n+x*x,0)/arr.length);}return {playing:!a.paused,time:a.currentTime,duration:a.duration,mediaOrigin:a.src?new URL(a.src).origin:null,rms,feedback:[...document.querySelectorAll('.feedback')].map(e=>e.textContent)};});
  records.push({provider:ref.provider,ref:entry.ref,title:entry.title,status:media.playing?'passed':'failed',...media});assert.equal(media.playing,true,media.feedback.join(' / '));assert(media.rms>.0001,'真实解码信号非零');assert.equal(media.mediaOrigin,base);
  await page.locator('.playbar').getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('button',{name:'打开正在播放',exact:true}).click();await page.screenshot({path:join(output,ref.provider+'.png')});await page.getByRole('button',{name:'返回浏览音乐',exact:true}).click();await openSettingsPage(page,'诊断与数据');await page.getByRole('button',{name:'停止播放并释放来源'}).click();await page.waitForFunction(async()=>{const s=await fetch('/api/status').then(r=>r.json());return s.delivery.leases===0&&s.delivery.activeReads===0&&s.sources.pending===0&&s.tool.active===0;},undefined,{timeout:15000});await closeSettingsPage(page);console.log('PASS',ref.provider,JSON.stringify(media));
 }
 assert.equal(browserErrors.length,0);
}catch(e){process.exitCode=1;records.push({status:'failed',error:e.message});console.log('FAIL',e.message);await page?.screenshot({path:join(output,'failure.png')}).catch(()=>{});}
finally{await browser?.close();writeFileSync(join(output,'lan.json'),JSON.stringify({date:new Date().toISOString(),environment,records,browserErrors,physicalPhone:false},null,2)+'\n');console.log('Evidence:',join(output,'lan.json'));}
