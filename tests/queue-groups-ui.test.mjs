import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from './helpers/browser.mjs';
import {createMobileFixture} from './helpers/mobile-fixture.mjs';
import {queueRecord} from './helpers/song-fixture.mjs';
import {developmentPaths} from '../scripts/workspace-paths.mjs';

const album='晚风现场 · 完整演唱会';
function record(base,large=false){
  const group=(id,count)=>Array.from({length:count},(_,index)=>({...base,ref:{...base.ref,part:String(9100+index)},resourceId:id+(index+1),title:`现场分曲 ${index+1}`,partsGroupId:id,partsGroupTitle:album}));
  const tracks=large?group('long',120):[...group('a',3),{...base,ref:{...base.ref,part:'9100'},resourceId:'solo',title:'单独加入的同源歌曲'},...group('b',3)];
  const value=queueRecord(tracks,{order:'shuffle',repeat:'off',shuffleGroups:true,current:large?'long1':'a2'});
  value.items.forEach((item,index)=>Object.assign(item,{partsGroupId:tracks[index].partsGroupId,partsGroupTitle:tracks[index].partsGroupTitle}));return value;
}
test('queue groups: independent batches, keyboard folding, preferences, scoped removal and responsive layout',async t=>{
  const fixture=await createMobileFixture({preview:true});t.after(fixture.close);
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const artifacts=join(developmentPaths().artifacts,'queue-groups-2026-11-13','ui');mkdirSync(artifacts,{recursive:true});
  const errors=[],measurements=[];
  const open=async(viewport,theme='light',large=false)=>{
    const page=await browser.newPage({viewport,colorScheme:theme});page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(value=>{if(!localStorage.getItem('slow-listening:playback:v3'))localStorage.setItem('slow-listening:playback:v3',JSON.stringify(value));},record(fixture.tracks[0],large));
    await page.route('**/*',route=>new URL(route.request().url()).origin===fixture.base?route.continue():route.abort());
    await page.goto(fixture.base);
    if(viewport.width<=760){await page.getByRole('button',{name:'打开正在播放',exact:true}).click();await page.getByRole('button',{name:'播放队列',exact:true}).click();}
    else await page.getByRole('button',{name:'打开播放队列',exact:true}).click();
    await page.locator('.queue-panel').waitFor();return page;
  };
  const page=await open({width:1440,height:900}),queue=page.locator('.queue-panel');
  await queue.getByRole('heading',{name:'播放队列 7 首',exact:true}).waitFor();assert.equal(await queue.locator('.queue-group').count(),2);assert.equal(await queue.locator('.queue-track').count(),1);
  const first=queue.locator('.queue-group[data-group-id="a"] .queue-group-toggle');
  assert.match(await first.innerText(),/当前第 2\/3 首/);
  const audio=await page.locator('audio').elementHandle(),prepared=fixture.preparations.length;
  await first.focus();await page.keyboard.press('Enter');assert.equal(await first.getAttribute('aria-expanded'),'true');assert.equal(await queue.locator('.queue-group-member').count(),3);
  await page.keyboard.press('Space');assert.equal(await first.getAttribute('aria-expanded'),'false');assert.equal(await queue.locator('.queue-group-member').count(),0);
  await queue.getByLabel('随机播放方式').selectOption('tracks');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')).shuffleGroups),false);
  assert(await audio.evaluate(element=>element===document.querySelector('audio')&&element.paused&&!element.getAttribute('src')));assert.equal(fixture.preparations.length,prepared);
  await page.reload();await page.getByRole('button',{name:'打开播放队列',exact:true}).click();assert.equal(await queue.getByLabel('随机播放方式').inputValue(),'tracks');
  await queue.locator('.queue-group[data-group-id="b"]').getByRole('button',{name:'整组操作 '+album,exact:true}).click();
  await page.getByRole('menuitem',{name:'移除整组（3 首）',exact:true}).click();
  await queue.getByRole('heading',{name:'播放队列 4 首',exact:true}).waitFor();assert.equal(await queue.locator('.queue-group').count(),1);assert.equal(await queue.locator('.queue-track').count(),1);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')).current),'a2');
  await queue.locator('.queue-group[data-group-id="a"]').getByRole('button',{name:'整组操作 '+album,exact:true}).click();await page.getByRole('menuitem',{name:'移除整组（3 首）',exact:true}).click();await queue.getByRole('heading',{name:'播放队列 1 首',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')).current),'solo');assert(await page.locator('audio').evaluate(element=>element.paused&&!element.getAttribute('src')));await page.close();
  for(const theme of ['light','dark'])for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:667,height:375}]){
    const view=await open(viewport,theme),panel=view.locator('.queue-panel');
    await panel.locator('.queue-group-toggle').first().click();await view.evaluate(()=>document.fonts.ready);await panel.locator('.queue-content').evaluate(element=>element.scrollTop=0);
    const metrics=await panel.evaluate(element=>{const content=element.querySelector('.queue-content').getBoundingClientRect(),selector=element.querySelector('select').getBoundingClientRect(),toggle=element.querySelector('.queue-group-toggle').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,panelOverflow:element.scrollWidth>element.clientWidth,content:content.height,selectHeight:selector.height,selectBottom:selector.bottom,toggleHeight:toggle.height,height:innerHeight};});
    assert.equal(metrics.overflow,false);assert.equal(metrics.panelOverflow,false);assert(metrics.content>=100,JSON.stringify({viewport,...metrics}));assert(metrics.selectBottom<=viewport.height);if(viewport.width<=760){assert(metrics.selectHeight>=48);assert(metrics.toggleHeight>=48);}
    measurements.push({theme,...viewport,...metrics});await view.screenshot({path:join(artifacts,`queue-${theme}-${viewport.width}.png`)});await view.close();
  }
  const long=await open({width:1440,height:900},'light',true),longQueue=long.locator('.queue-panel');
  await longQueue.locator('.queue-group-toggle').click();const start=longQueue.getByRole('button',{name:'播放队列歌曲 现场分曲 1',exact:true});await start.focus();
  assert((await longQueue.locator('.queue-track').count())<35);await longQueue.locator('.queue-content').evaluate(element=>element.scrollTop=element.scrollHeight);
  await longQueue.getByRole('button',{name:'播放队列歌曲 现场分曲 120',exact:true}).waitFor();assert(await start.evaluate(element=>document.activeElement===element));assert((await longQueue.locator('.queue-track').count())<35);await long.close();
  assert.deepEqual(errors,[]);writeFileSync(join(artifacts,'report.json'),JSON.stringify({measurements,errors},null,2));
});
