import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from './helpers/browser.mjs';
import {createPlayingArtworkFixture} from './helpers/playing-artwork-fixture.mjs';
import {queueRecord} from './helpers/song-fixture.mjs';
import {developmentPaths} from '../scripts/workspace-paths.mjs';

const artifacts=join(developmentPaths().artifacts,'biu-first-batch-20261030');
const creator=(id,name)=>({provider:'bilibili',id,name,url:'https://space.bilibili.com/'+id,description:'创作歌曲与现场演出，和你分享音乐日常。',followers:12345,verification:'音乐人'});

test('desktop and mobile search preserve platform sort, page and local follow state across author navigation',{timeout:180000},async t=>{
  mkdirSync(artifacts,{recursive:true});const fixture=await createPlayingArtworkFixture();const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  for(const width of [1440,390,320]){
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],videoRequests=[],userRequests=[],followRequests=[];
    let creators=[],revision=0,failFollow=false,failSearch=false;
    const users=[creator('101','许嵩'),creator('102','许嵩音乐资料站的超长昵称测试')];
    page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/api/search',route=>{const input=route.request().postDataJSON();videoRequests.push(input);return route.fulfill({json:{items:[{...fixture.tracks[0],title:'排序结果 '+input.order}]}});});
    await context.route('**/api/creators/search',async route=>{
      const input=route.request().postDataJSON();userRequests.push(input);
      if(input.query==='慢请求')await new Promise(resolve=>setTimeout(resolve,150));
      if(failSearch)return route.fulfill({status:403,json:{error:{code:'restricted',provider:'bilibili'}}});
      const items=input.page===2?[creator('103','第二页作者')]:input.query==='快请求'?[creator('104','最新请求作者')]:users;
      return route.fulfill({json:{items,page:input.page,pageSize:input.pageSize,total:61,hasMore:input.page<3}});
    });
    await context.route('**/api/follows',async route=>{
      if(route.request().method()==='POST'){
        const input=route.request().postDataJSON();followRequests.push(input);
        if(failFollow)return route.fulfill({status:503,json:{error:{code:'network'}}});
        const item=[...users,creator('103','第二页作者'),creator('104','最新请求作者')].find(item=>item.id===input.creator.id);
        creators=input.action==='follow'?[...creators,{...item,followedAt:1}]:creators.filter(item=>item.id!==input.creator.id);revision++;
      }
      return route.fulfill({json:{revision:String(revision),creators}});
    });
    await context.route('**/api/follows?*',route=>route.fulfill({json:{revision:String(revision),creators}}));
    await context.route('**/api/follows/videos?*',route=>route.fulfill({json:{items:[],total:0,page:1,pageSize:30}}));
    await context.route('**/api/follows/collections?*',route=>route.fulfill({json:{items:[]}}));
    await page.goto(fixture.base);await page.locator('.app').waitFor();
    await page.getByRole('button',{name:width>760?'开始搜索':'搜索歌曲或视频',exact:true}).first().click();
    let surface=page.getByRole(width>760?'dialog':'main',{name:'搜索音乐',exact:true});
    const input=surface.getByLabel(width>760?'弹窗搜索关键词':'搜索关键词',{exact:true});
    await input.fill('许嵩');await surface.getByRole('button',{name:'搜索',exact:true}).click();
    await surface.getByText('排序结果 relevance',{exact:true}).waitFor();
    for(const [name,order] of [['最多播放','plays'],['最多收藏','favorites'],['最新发布','newest']]){
      await surface.getByRole('button',{name,exact:true}).click();await surface.getByText('排序结果 '+order,{exact:true}).waitFor();
      assert.equal(videoRequests.at(-1).order,order);assert.equal(videoRequests.at(-1).cursor,undefined);
    }
    await surface.getByRole('button',{name:'用户',exact:true}).click();await surface.getByRole('article',{name:'许嵩',exact:true}).waitFor();
    assert.equal(userRequests.at(-1).query,'许嵩');assert.equal(userRequests.at(-1).page,1);
    await surface.getByRole('button',{name:'视频',exact:true}).click();await surface.getByText('排序结果 newest',{exact:true}).waitFor();
    assert.deepEqual(videoRequests.at(-1).song,{title:'许嵩'},'switching search types without changing the query retains the song context');
    await surface.getByRole('button',{name:'用户',exact:true}).click();await surface.getByRole('article',{name:'许嵩',exact:true}).waitFor();
    const card=surface.getByRole('article',{name:'许嵩',exact:true});
    await card.getByRole('button',{name:'关注到慢听 许嵩',exact:true}).click();await card.getByRole('button',{name:'取消关注 许嵩',exact:true}).waitFor();
    assert.equal(followRequests.length,1);assert.equal(followRequests[0].action,'follow');
    failFollow=true;await card.getByRole('button',{name:'取消关注 许嵩',exact:true}).click();await card.getByRole('alert').waitFor();assert.equal(await card.getByRole('button',{name:'取消关注 许嵩',exact:true}).getAttribute('aria-pressed'),'true');
    failFollow=false;await card.getByRole('button',{name:'取消关注 许嵩',exact:true}).click();await card.getByRole('button',{name:'关注到慢听 许嵩',exact:true}).waitFor();
    await surface.getByLabel('用户搜索排序').selectOption('followers');await page.waitForFunction(()=>document.querySelector('.creator-search-results[aria-busy="false"]'));assert.equal(userRequests.at(-1).order,'followers');
    await surface.getByRole('button',{name:'用户搜索下一页',exact:true}).click();await surface.getByRole('article',{name:'第二页作者',exact:true}).waitFor();assert.equal(userRequests.at(-1).page,2);
    await page.screenshot({path:join(artifacts,'user-search-'+width+'.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'search does not overflow the viewport');
    const cardBounds=await surface.locator('.creator-search-card').first().boundingBox();assert(cardBounds.x>=0&&cardBounds.x+cardBounds.width<=width,'user cards stay fully visible inside the local search scroller');
    await surface.getByRole('button',{name:'查看投稿',exact:true}).click();await page.locator('.follow-author-heading h2').getByText('第二页作者',{exact:true}).waitFor();
    await page.getByRole('button',{name:'返回用户搜索',exact:true}).click();
    surface=page.getByRole(width>760?'dialog':'main',{name:'搜索音乐',exact:true});await surface.getByRole('article',{name:'第二页作者',exact:true}).waitFor();assert.equal(await surface.getByLabel('用户搜索排序').inputValue(),'followers');assert.equal(await surface.getByLabel('用户搜索页码').inputValue(),'2');
    await input.fill('慢请求');await surface.getByRole('button',{name:'搜索',exact:true}).click();await input.fill('快请求');await surface.getByRole('button',{name:'搜索',exact:true}).click();await surface.getByRole('article',{name:'最新请求作者',exact:true}).waitFor();
    await page.waitForTimeout(200);assert.equal(await surface.getByRole('article',{name:'许嵩',exact:true}).count(),0,'late cancelled result cannot replace the current query');
    failSearch=true;await input.fill('风控');await surface.getByRole('button',{name:'搜索',exact:true}).click();await surface.getByRole('button',{name:'重试用户搜索',exact:true}).waitFor();assert.equal(await surface.getByRole('heading',{name:'没有找到用户',exact:true}).count(),0);
    failSearch=false;await surface.getByRole('button',{name:'重试用户搜索',exact:true}).click();await surface.getByRole('article',{name:'许嵩',exact:true}).waitFor();
    await surface.getByRole('button',{name:'视频',exact:true}).click();await surface.getByText('排序结果 newest',{exact:true}).waitFor();assert.equal(await surface.getByRole('button',{name:'最新发布',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(videoRequests.at(-1).query,'风控');
    assert.deepEqual(videoRequests.at(-1).song,{title:'风控'},'returning to videos uses the submitted user query instead of the previous song');
    assert.deepEqual(errors,[]);await context.close();
  }
});

test('immersive quick calibration previews without restarting audio and saves only the current source',{timeout:90000},async t=>{
  mkdirSync(artifacts,{recursive:true});const fixture=await createPlayingArtworkFixture(),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),writes=[],errors=[];
  let offsetMs=0,revision=0,failSave=false;
  const document={provider:'local',id:'calibration',title:'受控校准',artists:[],synced:true,lines:[{startMs:0,text:'风从远方来'},{startMs:4000,text:'把心事轻轻收藏'},{startMs:8000,text:'再听一会音乐'}]};
  await context.addInitScript(record=>localStorage.setItem('slow-listening:playback:v3',JSON.stringify(record)),queueRecord(fixture.tracks));
  await context.route('**/api/lyrics/state',route=>route.fulfill({json:{revision:String(revision),offsetMs,document}}));
  await context.route('**/api/lyrics/offset',route=>{const input=route.request().postDataJSON();writes.push(input);if(failSave)return route.fulfill({status:409,json:{error:{code:'conflict'}}});offsetMs=input.offsetMs;revision++;return route.fulfill({json:{revision:String(revision),offsetMs,document}});});
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  await page.goto(fixture.base);await page.getByRole('button',{name:'打开正在播放',exact:true}).click();await page.locator('.listening-transport .play-toggle').click();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.2);await page.locator('.listening-transport .play-toggle').click();
  await page.getByRole('button',{name:'打开沉浸歌词',exact:true}).click();await page.locator('.desktop-lyrics-host .slow-lyric-line').first().waitFor();
  const audio=await page.locator('audio').elementHandle(),prepares=fixture.preparations.length;
  await page.getByRole('button',{name:'校准时间',exact:true}).click();let panel=page.locator('.lyric-offset-popover [popover]:popover-open');
  await panel.getByRole('button',{name:'延后 0.05 秒',exact:true}).click();assert.equal(await panel.getByLabel('歌词延后秒数').inputValue(),'0.05');assert.equal(writes.length,0);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'校准时间',exact:true}).click();assert.equal(await panel.getByLabel('歌词延后秒数').inputValue(),'0','closing reverts the unsaved draft');
  await panel.getByLabel('歌词时间精调').fill('2.85');await panel.getByRole('button',{name:'保存偏移',exact:true}).click();await panel.getByRole('button',{name:'保存偏移',exact:true}).isDisabled();await page.waitForFunction(()=>document.querySelector('.lyric-offset-value small')?.textContent==='已保存');
  assert.equal(writes.at(-1).offsetMs,2850);assert.deepEqual(writes.at(-1).ref,fixture.tracks[0].ref);
  await page.locator('audio').evaluate(audio=>{audio.currentTime=8;audio.dispatchEvent(new Event('timeupdate'));});await page.waitForFunction(()=>document.querySelector('.desktop-lyrics-host')?.dataset.activeLine==='1');
  await page.waitForFunction(()=>{const host=document.querySelector('.desktop-lyrics-host'),row=host?.shadowRoot?.querySelector('[aria-current="true"]');if(!row)return false;const bounds=row.getBoundingClientRect(),area=host.getBoundingClientRect();return bounds.width>0&&bounds.bottom>area.top&&bounds.top<area.bottom;});
  await page.waitForTimeout(1300); // Let the existing lyric spring settle before accepting the screenshot.
  await page.screenshot({path:join(artifacts,'quick-calibration.png'),fullPage:true});
  await panel.getByRole('button',{name:'归零',exact:true}).click();await panel.getByRole('button',{name:'撤销调整',exact:true}).click();assert.equal(await panel.getByLabel('歌词延后秒数').inputValue(),'2.85');
  failSave=true;await panel.getByRole('button',{name:'提前 0.05 秒',exact:true}).click();await panel.getByRole('button',{name:'保存偏移',exact:true}).click();await panel.getByRole('button',{name:'重读当前歌词',exact:true}).waitFor();await panel.getByRole('button',{name:'重读当前歌词',exact:true}).click();failSave=false;
  await page.waitForFunction(()=>!document.querySelector('.lyric-offset-popover .feedback'));await panel.getByRole('button',{name:'保存偏移',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.lyric-offset-value small')?.textContent==='已保存');assert.equal(offsetMs,2800);
  assert.equal(await audio.evaluate(element=>element===document.querySelector('audio')),true);assert.equal(fixture.preparations.length,prepares);assert.deepEqual(errors,[]);
  await page.setViewportSize({width:800,height:480});await page.getByRole('button',{name:'校准时间',exact:true}).click();const bounds=await panel.boundingBox();assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=800&&bounds.y+bounds.height<=480,'the calibration panel avoids short-window edges');
});
