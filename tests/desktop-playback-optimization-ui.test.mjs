import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import { chromium } from './helpers/browser.mjs';
import {createMusicService,MediaDelivery} from '@studio/music-sources/service';
import {createPlayingArtworkFixture} from './helpers/playing-artwork-fixture.mjs';
const {DesktopPlayback}=await import(pathToFileURL(resolve(process.env.MUSIC_APP_TEST_BUILD??'.','dist/server/desktop-playback.js')));
const {defaultSearchConfig}=await import(pathToFileURL(resolve(process.env.MUSIC_APP_TEST_BUILD??'.','dist/server/search-policy.js')));

async function setup(t){
  let fixture,preparations=0,formatReads=0;
  const work=new DesktopPlayback(()=> 'fixture'),format={id:'wav',codec:'pcm',mimeType:'audio/wav',container:'wav'},delivery=new MediaDelivery({now:Date.now,fetch});
  const rawApi={
    capabilities:()=>({provider:'bilibili',operations:['metadata','prepare','formats','slowtune-desktop-audio'],anonymous:true,limitations:[]}),
    metadata:async ref=>fixture.tracks.find(track=>track.ref.id===ref.id),
    formats:async()=>{formatReads++;return [format];},
    prepare:async request=>{preparations++;const index=fixture.tracks.findIndex(track=>track.ref.id===request.ref.id),entry=fixture.tracks[index];return {entry,resourceId:entry.resourceId,format,delivery:{url:fixture.base+'/media/'+index+'.wav',requiresHost:true}};},
  };
  fixture=await createPlayingArtworkFixture({librarySeed:tracks=>({favorites:tracks}),handleRequest:async({request,response,url})=>{
    if(url.pathname==='/api/playback/prefetch'){
      const chunks=[];for await(const chunk of request)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks)),controller=new AbortController();response.on('close',()=>{if(!response.writableEnded)controller.abort();});
      const result=await work.run('fixture','prefetch',controller.signal,async signal=>{
        if(input.discard){work.discard(input.discard);return {ok:true};}
        const playback=await work.prepare(rawApi,{ref:input.ref},{signal},input.audioSupport),preparationToken=work.verified(playback);
        return {entry:{...playback.entry,verifiedAudio:{ref:playback.entry.ref,format:playback.format,preparationToken}}};
      },0);
      response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(result));return true;
    }
    if(!url.pathname.startsWith('/v1/'))return false;
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const controller=new AbortController();response.on('close',()=>{if(!response.writableEnded)controller.abort();});
    const options={method:request.method,headers:request.headers,signal:controller.signal,...(chunks.length?{body:Buffer.concat(chunks)}:{})};
    const sourceApi=new Proxy(rawApi,{get(target,property){if(property==='prepare'&&request.headers['x-slowtune-audio-support'])return (input,options)=>work.prepare(target,input,options,JSON.parse(request.headers['x-slowtune-audio-support']),request.headers['x-slowtune-preparation']);return Reflect.get(target,property);}});
    const service=createMusicService(sourceApi,delivery,{baseUrl:fixture.base,providers:['bilibili']});
    const invoke=s=>service.fetch(new Request(url, {...options,signal:s}));
    const result=request.headers['x-slowtune-surface']==='desktop'?await work.run('fixture',url.pathname,controller.signal,invoke):await invoke(controller.signal);
    response.writeHead(result.status,Object.fromEntries(result.headers));
    if(result.body)Readable.fromWeb(result.body).pipe(response);else response.end();return true;
  }});
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();work.dispose();await delivery.dispose();await fixture.close();});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(8000);
  await page.addInitScript(()=>{const original=HTMLMediaElement.prototype.canPlayType;HTMLMediaElement.prototype.canPlayType=function(type){return original.call(this,type==='audio/wav; codecs="pcm"'?'audio/wav':type);};});
  await page.route('**/*',route=>new URL(route.request().url()).origin===fixture.base?route.continue():route.abort());
  return {fixture,page,work,delivery,counts:()=>({preparations,formatReads})};
}
const open=async({fixture,page})=>{await page.goto(fixture.base);await page.locator('.sidebar-nav').getByRole('button',{name:'歌单',exact:true}).click();await page.getByRole('button',{name:'播放 '+fixture.tracks[0].title,exact:true}).waitFor();};

test('negotiated desktop preparation uses one protocol call and real PCM playback, with pending cancellation retaining current audio', {timeout:40000},async t=>{
  const context=await setup(t),{fixture,page,work}=context,requests=[];
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/v1/call/'))requests.push(new URL(request.url()).pathname);});
  await open(context);await page.getByRole('button',{name:'播放 '+fixture.tracks[0].title,exact:true}).click();
  try{await page.waitForFunction(()=>document.querySelector('audio').currentTime>.2);}catch(error){assert.fail(JSON.stringify({counts:context.counts(),requests,events:work.diagnostics(),audio:await page.locator('audio').evaluate(el=>({source:el.currentSrc,error:el.error?.code,paused:el.paused})),issue:await page.locator('.playback-issue').allTextContents()}));}
  assert.equal(requests.filter(path=>path==='/v1/call/prepare').length,1);assert.equal(requests.filter(path=>path==='/v1/call/formats').length,0);assert.deepEqual(context.counts(),{preparations:1,formatReads:1});
  const before=await page.locator('audio').evaluate(el=>({url:el.currentSrc,time:el.currentTime}));
  let release,requested;const pending=new Promise(resolve=>{requested=resolve;}),held=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  await page.route('**/v1/call/prepare',async route=>{requested();await held;await route.continue().catch(()=>{});});
  await page.getByRole('button',{name:'播放 '+fixture.tracks[1].title,exact:true}).click();await pending;
  await page.getByRole('button',{name:'取消播放准备',exact:true}).click();release();await page.waitForTimeout(350);
  const after=await page.locator('audio').evaluate(el=>({url:el.currentSrc,time:el.currentTime,paused:el.paused}));
  assert.equal(after.url,before.url);assert.equal(after.paused,false);assert(after.time>before.time);
  assert.equal(await page.locator('audio').count(),1);assert.equal(work.diagnostics().pending,0);
});

test('desktop metadata preparation has a bounded deadline and an actionable timeout message', {timeout:25000},async t=>{
  const context=await setup(t),{fixture,page}=context;let release;const held=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  await page.addInitScript(()=>{const schedule=window.setTimeout;window.setTimeout=(callback,delay,...args)=>schedule(callback,delay===60000?350:delay,...args);});
  await page.route('**/v1/call/metadata',async route=>{await held;await route.continue().catch(()=>{});});
  await page.goto(fixture.base);await page.locator('.app').waitFor();
  // Use a search result to exercise the metadata stage before usePlayback.run.
  await page.route('**/api/search',route=>route.fulfill({json:{items:[{...fixture.tracks[0],searchPartition:'radio'}],config:defaultSearchConfig(),preferredVersions:[]}}));
  await page.getByLabel('搜索歌曲或视频',{exact:true}).fill('慢听');await page.getByRole('button',{name:'开始搜索',exact:true}).click();
  await page.getByRole('button',{name:'播放 '+fixture.tracks[0].title,exact:true}).click();
  await page.getByRole('button',{name:'播放失败，查看详情',exact:true}).click();
  await page.getByText('来源响应超时，可以取消或重试。',{exact:true}).waitFor();
  assert.equal(context.counts().preparations,0);assert.equal(await page.locator('audio').evaluate(el=>el.paused),true);
});

test('desktop initial playback timeout leaves a retryable failure when media never starts', {timeout:25000},async t=>{
  const context=await setup(t),{fixture,page}=context;let release;const held=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  await page.addInitScript(()=>{const schedule=window.setTimeout;window.setTimeout=(callback,delay,...args)=>schedule(callback,delay===30000?250:delay,...args);});
  await page.route('**/v1/media/**',async route=>{await held;await route.continue().catch(()=>{});});
  await open(context);await page.getByRole('button',{name:'播放 '+fixture.tracks[0].title,exact:true}).click();
  await page.getByRole('button',{name:'播放失败，查看详情',exact:true}).click();
  await page.getByText('来源响应超时，可以取消或重试。',{exact:true}).waitFor();
  assert(await page.getByRole('button',{name:'重试播放',exact:true}).isVisible());assert(context.counts().preparations<=2,'initial timeout has bounded automatic recovery');
});

test('desktop next prefetch publishes no early media lease and next playback consumes it without another raw preparation', {timeout:25000},async t=>{
  const context=await setup(t),{page,work}=context;await open(context);
  await page.locator('.playlist-intro').getByRole('button',{name:'播放全部',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);
  assert.equal(context.counts().preparations,1);
  assert.equal(context.delivery.diagnostics().leases,1);
  await page.locator('audio').evaluate(audio=>{audio.currentTime=17;});
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>=17);
  for(let i=0;i<50&&work.diagnostics().tickets===0;i++)await page.waitForTimeout(50);
  assert.equal(work.diagnostics().tickets,1);assert.equal(context.counts().preparations,2);
  assert.equal(context.delivery.diagnostics().leases,1,'warming raw audio does not publish a second media lease');
  const media=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/v1/media/'))media.push(request.url());});
  await page.locator('.playbar').getByRole('button',{name:'下一首',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>.1&&document.querySelector('audio').currentTime<3);
  assert.equal(context.counts().preparations,2);assert.equal(work.diagnostics().tickets,0);
  assert(work.diagnostics().events.some(event=>event.code==='verified-reuse'));assert(media.length>0);
});
