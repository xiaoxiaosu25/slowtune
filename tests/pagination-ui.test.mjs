import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import { fromMusicRef } from './helpers/song-fixture.mjs';
import { createSettingsFixture } from './helpers/settings-fixture.mjs';
import { navigate } from '../scripts/browser-ui.mjs';

test('pagination: thousands of rows, first/last, jumps, sizes, filters, stable remote snapshots and responsive themes',{timeout:90000},async t=>{
  const fixture=await createSettingsFixture();
  const tracks=Array.from({length:2368},(_,index)=>({
    ref:{provider:'bilibili',kind:'video',id:'BV'+String(index+1).padStart(10,'0'),part:String(9000+index)},
    resourceId:'track-'+index,title:'分页歌曲 '+String(index+1).padStart(4,'0'),url:'https://www.bilibili.com/video/BV'+String(index+1).padStart(10,'0'),uploader:{id:'101',name:'分页作者'},publishedAt:2368-index,
  }));
  fixture.state.snapshot.favorites=tracks.map(track=>({ref:fromMusicRef(track.ref),metadata:{title:track.title,uploader:'分页作者'},availability:{state:'unknown'},addedAt:1}));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],reads=[];
  page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
  let stale=false;
  await page.route(/\/api\/follows(?:\/feed)?(?:\?|$)/,async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/follows')return route.fulfill({json:{revision:'paging-1',creators:[{provider:'bilibili',id:'101',name:'分页作者',url:'https://space.bilibili.com/101',followedAt:1}]}});
    if(url.pathname!=='/api/follows/feed')return route.fallback();
    const number=Number(url.searchParams.get('page')??1),size=Number(url.searchParams.get('pageSize')??60),snapshot=url.searchParams.get('snapshot');
    reads.push({page:number,size,snapshot});
    if(stale&&snapshot)return route.fulfill({status:503,json:{error:{code:'stale-cursor'}}});
    return route.fulfill({json:{items:tracks.slice((number-1)*size,number*size),total:tracks.length,snapshot:'stable-snapshot',page:number,pageSize:size,fetchedAt:1,warnings:[]}});
  });
  await page.goto(fixture.base);await page.locator('.app').waitFor();
  await navigate(page,'歌单');
  const library=page.locator('.list-view'),libraryRows=library.locator('.song-library-row');
  await libraryRows.first().waitFor();assert.equal(await libraryRows.count(),30);
  await page.getByRole('button',{name:'歌单歌曲尾页',exact:true}).click();
  assert.equal(await libraryRows.count(),28);assert.equal(await libraryRows.first().locator('.row-number').textContent(),'2341');
  assert(await page.getByRole('button',{name:'歌单歌曲下一页',exact:true}).isDisabled());
  await page.getByRole('combobox',{name:'歌单歌曲每页条数',exact:true}).selectOption('100');
  assert.equal(await libraryRows.count(),100);assert.equal(await page.getByRole('textbox',{name:'歌单歌曲页码',exact:true}).inputValue(),'1');
  const libraryInput=page.getByRole('textbox',{name:'歌单歌曲页码',exact:true});
  await libraryInput.fill('24');await libraryInput.press('Enter');assert.equal(await libraryRows.count(),68);
  await libraryInput.fill('9999');await libraryInput.press('Enter');assert.equal(await libraryInput.inputValue(),'24');
  await libraryInput.fill('abc');await libraryInput.press('Enter');assert.equal(await libraryInput.inputValue(),'24');
  await page.getByRole('button',{name:'歌单歌曲首页',exact:true}).click();
  await page.getByRole('textbox',{name:'搜索歌单内音乐',exact:true}).fill('分页歌曲 2300');
  assert.equal(await libraryRows.count(),1);assert.equal(await libraryRows.locator('.track-name').textContent(),'分页歌曲 2300');
  await page.getByRole('textbox',{name:'搜索歌单内音乐',exact:true}).fill('');
  await library.getByRole('button',{name:'播放全部',exact:true}).click();
  await page.getByRole('button',{name:'播放失败，查看详情',exact:true}).click();
  await page.getByText(/播放队列最多支持 500 首/).waitFor();await page.keyboard.press('Escape');
  await navigate(page,'关注');await page.getByRole('button',{name:'最近更新',exact:true}).click();
  const feed=page.locator('.follow-feed-pages'),input=page.getByRole('textbox',{name:'最近更新页码',exact:true});
  await input.waitFor();await page.waitForFunction(()=>!document.querySelector('.follow-feed-pages [aria-busy="true"]'));
  assert.equal(await feed.locator('.track-row').count(),30);
  await page.getByRole('button',{name:'最近更新尾页',exact:true}).click();await page.waitForFunction(()=>document.querySelector('input[aria-label="最近更新页码"]')?.value==='79');
  assert.equal(await feed.locator('.track-row').count(),28);assert.equal(reads.at(-1).snapshot,'stable-snapshot');assert.equal(reads.at(-1).page,79);
  await page.getByRole('button',{name:'关注的最近更新封面视图',exact:true}).click();assert.equal(await feed.locator('.music-card').count(),28);assert.equal(await input.inputValue(),'79');
  await page.getByRole('button',{name:'关注的最近更新列表视图',exact:true}).click();
  await navigate(page,'音乐榜单');await navigate(page,'关注');await input.waitFor();await page.waitForFunction(()=>!document.querySelector('.follow-feed-pages [aria-busy="true"]'));
  assert.equal(await input.inputValue(),'79');
  await page.getByRole('button',{name:'最近更新首页',exact:true}).click();await page.waitForFunction(()=>document.querySelector('input[aria-label="最近更新页码"]')?.value==='1');
  stale=true;await page.getByRole('button',{name:'最近更新下一页',exact:true}).click();await feed.getByText(/分页已过期/).waitFor();
  assert.equal(await input.inputValue(),'1');assert.equal(await feed.locator('.track-row').count(),30);
  stale=false;await page.getByRole('button',{name:'重新获取更新',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.follow-feed-pages [role="alert"]'));
  assert.equal(reads.at(-1).snapshot,null);
  fixture.state.searchItems=tracks.slice(0,35);fixture.state.searchPage2=tracks.slice(35,66);
  await page.getByRole('textbox',{name:'搜索歌曲或视频',exact:true}).fill('分页歌曲');
  await page.getByRole('button',{name:'开始搜索',exact:true}).click();
  const search=page.getByRole('dialog',{name:'搜索音乐',exact:true});
  await search.locator('.track-row').first().waitFor();
  assert.equal(await search.locator('.track-row').count(),30);
  assert(await search.getByRole('button',{name:'B站搜索结果尾页',exact:true}).isDisabled(),'a continuation is not a known tail');
  await search.getByRole('button',{name:'B站搜索结果下一页',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('input[aria-label="B站搜索结果页码"]')?.value==='2');
  assert.equal(await search.locator('.track-name').first().textContent(),'分页歌曲 0031');
  await search.getByRole('button',{name:'B站搜索结果尾页',exact:true}).click();
  assert.equal(await search.locator('.track-row').count(),6);
  await search.getByRole('button',{name:'关闭',exact:true}).click();
  const directory=resolve('local/verification/pagination');mkdirSync(directory,{recursive:true});
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1000});
    for(const palette of ['paper','mint','ocean','plum'])for(const theme of ['light','dark']){
      await page.evaluate(({palette,theme})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=theme;},{palette,theme});
      await feed.locator('.pagination').scrollIntoViewIfNeeded();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no overflow at ${width} ${palette} ${theme}`);
      if(width<500)assert((await feed.getByRole('button',{name:'最近更新尾页',exact:true}).boundingBox()).height>=44);
      await feed.locator('.pagination').screenshot({path:join(directory,`${width}-${palette}-${theme}.png`)});
    }
  }
  assert.deepEqual(errors,[]);
});

test('pagination: returning to a cursor list beyond the bounded refill keeps loaded content accessible',{timeout:30000},async t=>{
  const fixture=await createSettingsFixture(),browser=await chromium.launch({channel:'msedge',headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),reads=[];
  page.setDefaultTimeout(7000);
  const creator={provider:'bilibili',id:'101',name:'分页作者',url:'https://space.bilibili.com/101',followedAt:1};
  const collections=Array.from({length:600},(_,index)=>({id:'season:101:'+String(index+1),kind:'season',title:'分页合集 '+(index+1),url:creator.url,count:1}));
  await page.route(/\/api\/follows(?:\/(?:collections|videos))?(?:\?|$)/,async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/follows')return route.fulfill({json:{revision:'cursor-1',creators:[creator]}});
    if(url.pathname==='/api/follows/videos')return route.fulfill({json:{items:[],total:0,page:1,pageSize:30}});
    const number=Number(url.searchParams.get('cursor')??1);reads.push(number);
    return route.fulfill({json:{items:collections.slice((number-1)*20,number*20),cursor:String(number+1)}});
  });
  await page.goto(fixture.base);await page.locator('.app').waitFor();await navigate(page,'关注');
  await page.getByRole('button',{name:'查看 分页作者 的合集',exact:true}).click();
  const input=page.getByRole('textbox',{name:'作者合集页码',exact:true});
  const settled=number=>page.waitForFunction(number=>document.querySelector('input[aria-label="作者合集页码"]')?.value===String(number)&&document.querySelector('.follows-page .pagination')?.getAttribute('aria-busy')==='false',number);
  await settled(1);
  for(let number=2;number<=6;number++){
    await page.getByRole('button',{name:'作者合集下一页',exact:true}).click();await settled(number);
  }
  assert.match(await page.locator('.follow-collection-card').first().innerText(),/分页合集 151/);
  await page.getByRole('button',{name:'全部投稿',exact:true}).click();
  await page.getByRole('textbox',{name:'作者内容页码',exact:true}).waitFor();
  const before=reads.length;
  await page.getByRole('button',{name:'合集',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.follows-page .pagination')?.getAttribute('aria-label')==='作者合集分页'&&document.querySelector('.follows-page .pagination')?.getAttribute('aria-busy')==='false');
  assert.deepEqual(reads.slice(before),[1,2,3,4],'restoration keeps the source read budget bounded');
  assert.equal(await input.inputValue(),'2','a remembered page beyond loaded content falls back to a complete available page');
  assert.equal(await page.locator('.follow-collection-card').count(),30);
  assert.equal(await page.getByText('作者还没有公开合集',{exact:true}).count(),0);
  await page.getByRole('button',{name:'作者合集下一页',exact:true}).click();await settled(3);
  assert.match(await page.locator('.follow-collection-card').first().innerText(),/分页合集 61/);
  assert.match(await page.locator('.follow-collection-card').last().innerText(),/分页合集 90/,'the next read fills the unfinished page without skipping later arrivals');
  await page.getByRole('button',{name:'作者合集下一页',exact:true}).click();await settled(4);
  assert.equal(await page.locator('.follow-collection-card').count(),30,'reading can continue after the bounded fallback');
});

test('pagination: page changes keep the first row clear of desktop and mobile headers and modal boundaries',{timeout:30000},async t=>{
  const fixture=await createSettingsFixture(),browser=await chromium.launch({channel:'msedge',headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  fixture.state.chartItems=Array.from({length:180},(_,index)=>({rank:index+1,title:'翻页榜单 '+(index+1),artists:['测试歌手']}));
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(7000);
  await page.goto(fixture.base);await page.locator('.app').waitFor();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await navigate(page,'音乐榜单');
    await page.locator('.chart-song').first().waitFor();
    const first=page.getByRole('button',{name:'榜单歌曲首页',exact:true});if(!await first.isDisabled())await first.click();
    await page.getByRole('button',{name:'榜单歌曲下一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.chart-song')?.getAttribute('data-rank')==='31');
    const bounds=await page.locator('.chart-song').first().evaluate(element=>new Promise(resolve=>requestAnimationFrame(()=>resolve({row:element.getBoundingClientRect().top,header:document.querySelector('.topbar').getBoundingClientRect().bottom}))));
    assert(bounds.row>=bounds.header,`first chart row clears the fixed header at ${width}px: ${JSON.stringify(bounds)}`);
  }
  fixture.state.searchItems=Array.from({length:60},(_,index)=>({ref:{provider:'bilibili',kind:'video',id:'BV'+String(index+1).padStart(10,'0')},resourceId:'modal-'+index,title:'翻页歌曲 '+(index+1),url:'https://www.bilibili.com/video/BV'+String(index+1).padStart(10,'0')}));
  await navigate(page,'搜索');
  const search=page.getByRole('main',{name:'搜索音乐',exact:true});
  await search.getByRole('searchbox',{name:'搜索关键词',exact:true}).fill('翻页歌曲');await search.getByRole('button',{name:'搜索',exact:true}).click();
  await search.locator('.track-row').first().waitFor();
  await search.getByRole('button',{name:'B站搜索结果下一页',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('input[aria-label="B站搜索结果页码"]')?.value==='2');
  const bounds=await search.locator('.track-row').first().evaluate(element=>new Promise(resolve=>requestAnimationFrame(()=>resolve({row:element.getBoundingClientRect().top,container:document.querySelector('.search-results').getBoundingClientRect().top}))));
  assert(bounds.row>=bounds.container,'the modal first row remains below its own scroll boundary');
});
